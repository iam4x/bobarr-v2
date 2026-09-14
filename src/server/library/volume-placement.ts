import type { LibraryFile, LibraryItem, StorageVolume } from "../../contracts";
import type { DownloadPlacementContext } from "../application/acquisition-service";
import type { DownloadRecord } from "../application/ports";
import type { BackendDatabase, Repositories } from "../db";

import { realpath } from "node:fs/promises";

import { parseExistingEpisodeIdentity } from "./importer";
import { isPathContained } from "./paths";
import { withMediaMutation } from "../db/volume-transfers";
import {
  STORAGE_RESERVE_BYTES,
  measureFreeBytes,
  placeDownload,
} from "../storage";

export type MediaStorageGroup = {
  key: string;
  mediaIds: readonly string[];
} & (
  | { kind: "movie"; seriesId: null; seasonNumber: null }
  | { kind: "season"; seriesId: string; seasonNumber: number }
);

export type LibraryStorageGroup = MediaStorageGroup & { files: LibraryFile[] };

export function groupForMedia(
  mediaId: string,
  repositories: Repositories,
): MediaStorageGroup | null {
  const item = repositories.media.get(mediaId);
  if (!item) return null;
  if (item.kind === "movie") {
    return {
      key: `movie:${item.id}`,
      kind: "movie",
      mediaIds: [item.id],
      seriesId: null,
      seasonNumber: null,
    };
  }
  const season =
    item.kind === "episode" && item.parentId
      ? repositories.media.get(item.parentId)
      : item;
  if (
    season?.kind !== "season" ||
    season.seasonNumber === null ||
    !season.parentId
  )
    return null;
  const series = repositories.media.get(season.parentId);
  return series?.kind === "series"
    ? seasonGroup(series, season.seasonNumber, repositories)
    : null;
}

export function groupForLibraryFile(
  file: Pick<LibraryFile, "mediaId" | "path">,
  repositories: Repositories,
): MediaStorageGroup | null {
  const item = repositories.media.get(file.mediaId);
  if (item?.kind !== "series") return groupForMedia(file.mediaId, repositories);
  const { season } = parseExistingEpisodeIdentity(file.path);
  return season === null ? null : seasonGroup(item, season, repositories);
}

export function listLibraryGroups(
  repositories: Repositories,
): LibraryStorageGroup[] {
  const groups = new Map<string, LibraryStorageGroup>();
  for (let offset = 0; ; offset += 100) {
    const page = repositories.media.list({ limit: 100, offset });
    for (const item of page.items) {
      for (const file of repositories.libraryFiles.listForMedia(item.id)) {
        const group = groupForLibraryFile(file, repositories);
        if (!group) continue;
        const existing = groups.get(group.key);
        if (existing) existing.files.push(file);
        else groups.set(group.key, { ...group, files: [file] });
      }
    }
    if (offset + page.items.length >= page.total) break;
  }
  return [...groups.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

export function filesForGroup(
  group: MediaStorageGroup,
  repositories: Repositories,
): LibraryFile[] {
  return group.mediaIds.flatMap((mediaId) =>
    repositories.libraryFiles
      .listForMedia(mediaId)
      .filter(
        (file) => groupForLibraryFile(file, repositories)?.key === group.key,
      ),
  );
}

export async function volumeForLibraryGroup(input: {
  group: MediaStorageGroup;
  repositories: Repositories;
  volumes: readonly StorageVolume[];
}): Promise<StorageVolume | null> {
  const volumeIds = new Set<string>();
  const roots = await Promise.all(
    input.volumes.map(async (volume) => {
      const path =
        input.group.kind === "movie"
          ? volume.moviesPath
          : volume.televisionPath;
      return {
        volume,
        path,
        canonical: await realpath(path).catch(() => path),
      };
    }),
  );
  for (const file of filesForGroup(input.group, input.repositories)) {
    const volume = roots.find(
      (candidate) =>
        isPathContained(candidate.path, file.path) ||
        isPathContained(candidate.canonical, file.path),
    )?.volume;
    if (!volume)
      throw new Error("A media group uses an unavailable storage volume");
    volumeIds.add(volume.id);
  }
  if (volumeIds.size > 1) {
    throw new Error(
      "This movie or season is split across volumes; organize the volumes before adding files",
    );
  }
  return input.volumes.find((volume) => volumeIds.has(volume.id)) ?? null;
}

export function createDownloadPlacement(options: {
  database: BackendDatabase;
  repositories: Repositories;
  measure?: (path: string) => Promise<bigint | null>;
}) {
  let pending: Promise<void> = Promise.resolve();
  const measure = options.measure ?? measureFreeBytes;
  const { repositories } = options;

  function placementGroup(
    context: DownloadPlacementContext,
  ): MediaStorageGroup | null {
    const candidate = context.candidateId
      ? repositories.releases.resolve(context.candidateId)?.candidate
      : undefined;
    if (context.candidateId && !candidate)
      throw new Error(
        "This download candidate is no longer available; search again before retrying",
      );
    return candidate?.mediaId
      ? groupForMedia(candidate.mediaId, repositories)
      : null;
  }

  async function withDownloadPlacement(
    context: DownloadPlacementContext,
    operation: () => Promise<DownloadRecord>,
  ): Promise<DownloadRecord> {
    const previous = pending;
    const release = Promise.withResolvers<void>();
    pending = release.promise;
    await previous;
    try {
      const group = placementGroup(context);
      const mediaIds = group?.mediaIds ?? [];
      return await withMediaMutation(options.database, mediaIds, operation);
    } finally {
      release.resolve();
    }
  }

  async function placeDownloadDirectory(
    downloadId: string,
    context: DownloadPlacementContext,
  ): Promise<string> {
    const storage = repositories.settings.ensureDefaults().settings.storage;
    const group = placementGroup(context);
    const libraryVolume = group
      ? await volumeForLibraryGroup({
          group,
          repositories,
          volumes: storage.volumes,
        })
      : null;
    const downloadVolume = group
      ? volumeForPendingDownload(group, repositories, storage.volumes)
      : null;
    const affinity = libraryVolume ?? downloadVolume;
    const reservedBytes = pendingDownloadBytes(
      repositories,
      storage.volumes,
      storage.organizationStrategy === "copy",
    );
    const freeBytesByVolumeId = new Map<string, bigint>();
    for (const volume of affinity ? [affinity] : storage.volumes) {
      const free = await measure(volume.downloadsPath);
      if (free !== null)
        freeBytesByVolumeId.set(
          volume.id,
          free - (reservedBytes.get(volume.id) ?? 0n),
        );
    }
    const copyMultiplier = storage.organizationStrategy === "copy" ? 2n : 1n;
    const needed = BigInt(context.expectedBytes ?? 0) * copyMultiplier;
    const eligible = (affinity ? [affinity] : storage.volumes).filter(
      (volume) =>
        (freeBytesByVolumeId.get(volume.id) ?? 0n) - needed >
        STORAGE_RESERVE_BYTES,
    );
    if (eligible.length === 0) {
      throw new Error(
        affinity
          ? `Storage volume ${affinity.label} has insufficient free space for this movie or season; organize the volumes or free space before retrying`
          : "No storage volume has enough free space for this download",
      );
    }
    return placeDownload({ volumes: eligible, freeBytesByVolumeId, downloadId })
      .downloadDirectory;
  }

  return { placeDownloadDirectory, withDownloadPlacement };
}

function seasonGroup(
  series: LibraryItem,
  seasonNumber: number,
  repositories: Repositories,
): MediaStorageGroup {
  const mediaIds = repositories.media
    .children(series.id)
    .filter(
      (item) => item.kind === "season" && item.seasonNumber === seasonNumber,
    )
    .flatMap((season) => [
      season.id,
      ...repositories.media.children(season.id).map((episode) => episode.id),
    ]);
  if (
    repositories.libraryFiles
      .listForMedia(series.id)
      .some(
        (file) =>
          parseExistingEpisodeIdentity(file.path).season === seasonNumber,
      )
  )
    mediaIds.push(series.id);
  return {
    key: `season:${series.id}:${seasonNumber}`,
    kind: "season",
    mediaIds,
    seriesId: series.id,
    seasonNumber,
  };
}

function volumeForPendingDownload(
  group: MediaStorageGroup,
  repositories: Repositories,
  volumes: readonly StorageVolume[],
): StorageVolume | null {
  const matches = group.mediaIds
    .flatMap((mediaId) => {
      const downloads = [];
      for (let offset = 0; ; offset += 100) {
        const page = repositories.downloads.list({
          mediaId,
          limit: 100,
          offset,
        });
        downloads.push(
          ...page.downloads.filter(
            (download) =>
              download.downloadPath !== null && download.state !== "failed",
          ),
        );
        if (offset + page.downloads.length >= page.total) break;
      }
      return downloads;
    })
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
  for (const download of matches) {
    if (
      download.mediaId &&
      groupForMedia(download.mediaId, repositories)?.key !== group.key
    )
      continue;
    const volume = volumes.find(
      (candidate) =>
        download.downloadPath !== null &&
        isPathContained(candidate.downloadsPath, download.downloadPath),
    );
    if (volume) return volume;
  }
  return null;
}

function pendingDownloadBytes(
  repositories: Repositories,
  volumes: readonly StorageVolume[],
  copiesLibrary: boolean,
): ReadonlyMap<string, bigint> {
  const reserved = new Map<string, bigint>();
  for (let offset = 0; ; offset += 100) {
    const page = repositories.downloads.list({
      limit: 100,
      offset,
      completion: "active",
    });
    for (const download of page.downloads) {
      if (download.state === "failed" || !download.downloadPath) continue;
      const volume = volumes.find((candidate) =>
        isPathContained(candidate.downloadsPath, download.downloadPath ?? ""),
      );
      if (!volume) continue;
      const expected = Math.max(download.totalBytes, download.downloadedBytes);
      const remaining = BigInt(
        Math.max(0, expected - download.downloadedBytes),
      );
      const libraryCopy = copiesLibrary ? BigInt(expected) : 0n;
      reserved.set(
        volume.id,
        (reserved.get(volume.id) ?? 0n) + remaining + libraryCopy,
      );
    }
    if (offset + page.downloads.length >= page.total) break;
  }
  return reserved;
}
