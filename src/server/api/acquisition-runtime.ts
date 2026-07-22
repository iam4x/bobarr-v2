import type { AcquisitionState, LibraryItem } from "../../contracts";
import type { AcquisitionService } from "../application";
import type { BackendConfig } from "../config";
import type { BackendDatabase, Repositories } from "../db";
import type { ReleaseProfile, ReleaseTarget } from "../domain/releases";
import type { EventHub } from "../events";
import type { JobHandler, JobQueue } from "../jobs";
import type { IntegrationResolver } from "./integration-resolver";

import { stat } from "node:fs/promises";
import { basename } from "node:path";

import {
  ADD_TORRENT_JOB,
  ORGANIZE_DOWNLOAD_JOB,
  candidateRepositoryFromDatabase,
  createAcquisitionService,
  createAesCandidateCipher,
  createFilesystemLibraryOrganizer,
  downloadRepositoryFromDatabase,
  isOwnedTorrent,
} from "../application";
import {
  aggregateChildAcquisitionState,
  organizedEpisodeNumbers,
} from "../domain";
import { importRecordedFiles, scanLibrary } from "../library";

const MEDIA_ACQUIRE_JOB = "media.acquire.v1";
const LIBRARY_SCAN_JOB = "library.scan.v1";
const DOWNLOAD_SNAPSHOT_PAGE_SIZE = 100;

export interface AcquisitionRuntime {
  service(): Promise<AcquisitionService>;
  handlers: Readonly<Record<string, JobHandler>>;
  reconcile(signal?: AbortSignal): Promise<void>;
  publishLiveProgress(signal?: AbortSignal): Promise<void>;
  synchronizeMediaStates(): void;
}

export interface AcquisitionRuntimeOptions {
  config: BackendConfig;
  database: BackendDatabase;
  repositories: Repositories;
  queue: JobQueue;
  events: EventHub;
  integrations: IntegrationResolver;
}

export function createAcquisitionRuntime(
  options: AcquisitionRuntimeOptions,
): AcquisitionRuntime {
  const candidateCipher = createAesCandidateCipher({
    key: Uint8Array.fromBase64(options.config.encryptionKey, {
      alphabet: "base64url",
    }),
  });

  async function service(): Promise<AcquisitionService> {
    const settings = options.repositories.settings.ensureDefaults().settings;
    const filesystemOptions = {
      downloadsRoot: settings.storage.downloadsPath,
      movieLibraryRoot: settings.storage.moviesPath,
      seriesLibraryRoot: settings.storage.televisionPath,
      mode: settings.storage.organizationStrategy,
      fallbackToCopy: false,
    } as const;
    const filesystem = createFilesystemLibraryOrganizer({
      ...filesystemOptions,
      collision: "error",
    });
    const replacementFilesystem = createFilesystemLibraryOrganizer({
      ...filesystemOptions,
      collision: "replace",
    });

    return createAcquisitionService(
      {
        indexer: {
          search: async (request) =>
            (await options.integrations.jackett()).search(request),
          fetchMetainfo: async (url, signal) =>
            (await options.integrations.jackett()).downloadTorrent(url, signal),
        },
        torrentEngine: {
          add: async (source, addOptions, signal) =>
            (await options.integrations.transmission()).add(
              source,
              addOptions,
              signal,
            ),
          get: async (hash, signal) =>
            (await options.integrations.transmission()).get(hash, signal),
          list: async (signal) =>
            (await options.integrations.transmission()).list(signal),
          selectFiles: async (hash, selection, signal) =>
            (await options.integrations.transmission()).selectFiles(
              hash,
              selection,
              signal,
            ),
          start: async (hash, signal) =>
            (await options.integrations.transmission()).start(hash, signal),
          pause: async (hash, signal) =>
            (await options.integrations.transmission()).pause(hash, signal),
          remove: async (hash, deleteData, signal) =>
            (await options.integrations.transmission()).remove(
              hash,
              deleteData,
              signal,
            ),
        },
        candidateRepository: candidateRepositoryFromDatabase(
          options.repositories.releases,
        ),
        downloadRepository: downloadRepositoryFromDatabase(options.database),
        candidateCipher,
        jobQueue: options.queue,
        libraryOrganizer: {
          async organize(request, signal) {
            const download = options.repositories.downloads.get(
              request.downloadId,
            );
            if (!download?.mediaId) {
              appendActivity(
                options,
                "download.completed",
                "success",
                `${download?.title ?? request.torrentName} completed; manual downloads are left in place`,
                null,
                { downloadId: request.downloadId },
              );
              return [];
            }
            const mediaBeforeOrganization = options.repositories.media.get(
              download.mediaId,
            );
            const replacing =
              mediaBeforeOrganization?.metadata["replacementPending"] === true;
            const organized = await (
              replacing ? replacementFilesystem : filesystem
            ).organize(request, signal);
            if (download?.mediaId) {
              for (const file of organized) {
                const fileInfo = await stat(file.destination);
                options.repositories.libraryFiles.upsert({
                  mediaId: download.mediaId,
                  downloadId: download.id,
                  path: file.destination,
                  sizeBytes: fileInfo.size,
                  quality: null,
                  videoCodec: null,
                  audioCodec: null,
                  strategy: settings.storage.organizationStrategy,
                });
              }
              markOrganizedEpisodes(
                download.mediaId,
                organized.map((file) => file.source),
                options.repositories,
              );
              if (replacing && mediaBeforeOrganization) {
                options.repositories.media.updateMetadata(download.mediaId, {
                  metadata: {
                    ...mediaBeforeOrganization.metadata,
                    replacementPending: false,
                  },
                });
              }
              const organizedItem = options.repositories.media.get(
                download.mediaId,
              );
              const organizedState =
                organizedItem?.kind === "season" &&
                options.repositories.media.children(organizedItem.id).length > 0
                  ? aggregateChildAcquisitionState(
                      options.repositories.media.children(organizedItem.id),
                    )
                  : "available";
              updateMediaTreeState(
                download.mediaId,
                organizedState,
                options.repositories,
              );
              options.events.publish("library.changed", {
                id: download.mediaId,
              });
            }
            options.events.publish("download.changed", {
              id: request.downloadId,
            });
            return organized;
          },
        },
      },
      {
        downloadRoot: settings.storage.downloadsPath,
      },
    );
  }

  const handlers: Record<string, JobHandler> = {
    [ADD_TORRENT_JOB]: async (job, context) => {
      await (
        await service()
      ).runAddJob(jobDownloadId(job.payload), context.signal);
      options.events.publish("download.changed", {
        id: jobDownloadId(job.payload),
      });
    },
    [ORGANIZE_DOWNLOAD_JOB]: async (job, context) => {
      await (
        await service()
      ).runOrganizeJob(jobDownloadId(job.payload), context.signal);
    },
    [MEDIA_ACQUIRE_JOB]: async (job, context) => {
      await acquireMedia(
        jobMediaId(job.payload),
        context.signal,
        options,
        service,
      );
    },
    [LIBRARY_SCAN_JOB]: async (job, context) => {
      await importLibrary(job.payload, context.signal, options);
    },
  };

  function synchronizeMediaStates(): void {
    synchronizeAllMediaStates(options.repositories);
  }

  return {
    service,
    handlers,
    synchronizeMediaStates,
    async reconcile(signal) {
      await (await service()).reconcile(signal);
      synchronizeMediaStates();
      options.events.publish("snapshot.invalidated", {
        resources: ["downloads", "library"],
      });
    },
    async publishLiveProgress(signal) {
      const durableDownloads = await downloadRepositoryFromDatabase(
        options.database,
      ).listForReconciliation();
      const durableById = new Map(
        durableDownloads.map((download) => [download.id, download]),
      );
      const downloadRoot =
        options.repositories.settings.ensureDefaults().settings.storage
          .downloadsPath;
      const torrents = await (
        await options.integrations.transmission()
      ).list(signal);
      for (const torrent of torrents) {
        const label = torrent.labels.find((value) =>
          /^bobarr:[a-f\d-]{36}$/i.test(value),
        );
        if (!label) continue;
        const id = label.slice("bobarr:".length);
        const durable = durableById.get(id);
        if (!durable || !isOwnedTorrent(durable, torrent, downloadRoot)) {
          continue;
        }
        options.events.publish("download.changed", {
          id,
          progress: Math.round(torrent.progress * 10_000) / 100,
          downloadRate: torrent.downloadRate,
          uploadRate: torrent.uploadRate,
          etaSeconds: torrent.etaSeconds,
          state: torrent.status,
        });
      }
    },
  };
}

export function synchronizeAllMediaStates(repositories: Repositories): void {
  const downloads = [];
  let offset = 0;
  while (true) {
    const page = repositories.downloads.list({
      limit: DOWNLOAD_SNAPSHOT_PAGE_SIZE,
      offset,
    });
    downloads.push(...page.downloads);
    offset += page.downloads.length;
    if (page.downloads.length === 0 || offset >= page.total) break;
  }

  const synchronizedMedia = new Set<string>();
  for (const download of downloads) {
    if (!download.mediaId || synchronizedMedia.has(download.mediaId)) continue;
    const state = mediaStateForDownload(download.state);
    if (state) {
      updateMediaTreeState(download.mediaId, state, repositories);
      // Downloads are snapshotted newest-first. A replacement or retry must
      // not be overwritten by an older completed/failed attempt.
      synchronizedMedia.add(download.mediaId);
    }
  }
}

async function acquireMedia(
  mediaId: string,
  signal: AbortSignal,
  options: AcquisitionRuntimeOptions,
  createService: () => Promise<AcquisitionService>,
): Promise<void> {
  const item = options.repositories.media.get(mediaId);
  if (!item || item.monitorPolicy === "none") return;
  const target = targetForItem(item, options.repositories);
  const tmdbId = tmdbIdForItem(item, options.repositories);
  updateMediaTreeState(item.id, "searching", options.repositories);
  options.events.publish("library.changed", { id: item.id });
  try {
    const settings = options.repositories.settings.ensureDefaults().settings;
    const result = await (
      await createService()
    ).searchCandidates({
      target,
      profile: releaseProfile(settings.acquisition),
      mediaId: item.id,
      ...(tmdbId === null ? {} : { tmdbId }),
      signal,
    });
    const candidate = result.candidates[0];
    if (!candidate) {
      const latest = options.repositories.media.get(item.id);
      if (!latest || latest.monitorPolicy === "none") return;
      if (latest.metadata["replacementPending"] === true) {
        options.repositories.media.updateMetadata(latest.id, {
          metadata: {
            ...latest.metadata,
            replacementPending: false,
          },
        });
        const preservedState =
          options.repositories.libraryFiles.listForMedia(latest.id).length > 0
            ? "available"
            : "missing";
        updateMediaTreeState(item.id, preservedState, options.repositories);
        appendActivity(
          options,
          "acquisition.replacement-missing",
          "warning",
          `No eligible replacement was found for ${item.title}; the existing library file was preserved`,
          item.id,
        );
        return;
      }
      updateMediaTreeState(item.id, "missing", options.repositories);
      appendActivity(
        options,
        "acquisition.missing",
        "warning",
        `No eligible release was found for ${item.title}`,
        item.id,
      );
      return;
    }
    const latest = options.repositories.media.get(item.id);
    if (!latest || latest.monitorPolicy === "none") return;
    await (await createService()).startFromCandidate(candidate.id);
    updateMediaTreeState(item.id, "queued", options.repositories);
    appendActivity(
      options,
      "acquisition.queued",
      "info",
      `${candidate.title} was selected for ${item.title}`,
      item.id,
    );
  } catch (error) {
    const latest = options.repositories.media.get(item.id);
    if (!latest || latest.monitorPolicy === "none") {
      if (latest) {
        updateMediaTreeState(item.id, "unmonitored", options.repositories);
      }
      return;
    }
    updateMediaTreeState(item.id, "failed", options.repositories);
    options.events.publish("library.changed", { id: item.id });
    throw error;
  }
}

function targetForItem(
  item: LibraryItem,
  repositories: Repositories,
): ReleaseTarget {
  if (item.kind === "movie") {
    return {
      kind: "movie",
      title: item.title,
      year: item.year ?? undefined,
      releaseDate: item.releaseDate,
    };
  }
  let seasonItem: LibraryItem | undefined;
  if (item.kind === "episode" && item.parentId) {
    seasonItem = repositories.media.get(item.parentId);
  } else if (item.kind === "season") {
    seasonItem = item;
  }
  let seriesItem: LibraryItem | undefined;
  if (item.kind === "series") {
    seriesItem = item;
  } else if (seasonItem?.parentId) {
    seriesItem = repositories.media.get(seasonItem.parentId);
  }
  const title = seriesItem?.title ?? item.title.replace(/ — Season \d+$/, "");
  const season = item.seasonNumber ?? 1;
  if (item.kind === "episode") {
    return {
      kind: "episode",
      title,
      year: seriesItem?.year ?? item.year ?? undefined,
      season,
      episode: item.episodeNumber ?? 1,
      releaseDate: item.releaseDate,
    };
  }
  return {
    kind: "season",
    title,
    year: seriesItem?.year ?? item.year ?? undefined,
    season,
    releaseDate: item.releaseDate,
  };
}

function tmdbIdForItem(
  item: LibraryItem,
  repositories: Repositories,
): number | null {
  if ((item.kind === "movie" || item.kind === "series") && item.tmdbId) {
    return item.tmdbId;
  }
  if (!item.parentId) return null;
  const parent = repositories.media.get(item.parentId);
  if (!parent) return null;
  if (parent.kind === "series") return parent.tmdbId;
  if (!parent.parentId) return null;
  return repositories.media.get(parent.parentId)?.tmdbId ?? null;
}

function releaseProfile(settings: {
  minimumSeeders: number;
  minimumSizeMb: number | null;
  maximumSizeMb: number | null;
  requiredTerms: string[];
  preferredTerms: string[];
  rejectedTerms: string[];
  qualityOrder: string[];
}): ReleaseProfile {
  return {
    minimumSeeders: settings.minimumSeeders,
    ...(settings.minimumSizeMb === null
      ? {}
      : { minimumSizeBytes: settings.minimumSizeMb * 1024 * 1024 }),
    ...(settings.maximumSizeMb === null
      ? {}
      : { maximumSizeBytes: settings.maximumSizeMb * 1024 * 1024 }),
    qualityOrder: settings.qualityOrder.filter(isReleaseQuality),
    requiredTerms: settings.requiredTerms,
    excludedTerms: settings.rejectedTerms,
    preferredTerms: Object.fromEntries(
      settings.preferredTerms.map((term, index) => [
        term,
        settings.preferredTerms.length - index,
      ]),
    ),
  };
}

function isReleaseQuality(
  value: string,
): value is "2160p" | "1080p" | "720p" | "480p" | "unknown" {
  return ["2160p", "1080p", "720p", "480p", "unknown"].includes(value);
}

async function importLibrary(
  payload: unknown,
  signal: AbortSignal,
  options: AcquisitionRuntimeOptions,
): Promise<void> {
  const roots = jobRoots(payload);
  const settings = options.repositories.settings.ensureDefaults().settings;
  const tmdb = await options.integrations.tmdb();
  let imported = 0;
  let reviews = 0;
  for (const root of roots) {
    signal.throwIfAborted();
    const kind = root === settings.storage.moviesPath ? "movie" : "series";
    const files = await scanLibrary({ root });
    const groups = groupScanFiles(files.map((file) => ({ ...file, kind })));
    for (const group of groups.values()) {
      signal.throwIfAborted();
      const result = await tmdb.search(group.title, {
        page: 1,
        language: settings.locale.language,
        region: settings.locale.region,
        year: group.year ?? undefined,
        signal,
      });
      const matches = result.results.filter(
        (item) =>
          (item.mediaType === "movie" ? "movie" : "series") === group.kind &&
          normalizeTitle(item.title) === normalizeTitle(group.title) &&
          (group.year === null || item.year === group.year),
      );
      if (matches.length !== 1) {
        reviews += 1;
        const review = options.repositories.scanReviews.upsert({
          kind: group.kind,
          title: group.title,
          year: group.year,
          rootPath: root,
          files: group.files.map((file) => ({
            path: file.absolutePath,
            sizeBytes: file.sizeBytes,
          })),
          candidates: result.results
            .filter(
              (item) =>
                (item.mediaType === "movie" ? "movie" : "series") ===
                group.kind,
            )
            .slice(0, 12)
            .map((item) => ({
              tmdbId: item.tmdbId,
              kind: group.kind,
              title: item.title,
              year: item.year,
              posterPath: item.posterPath,
              overview: item.overview,
            })),
        });
        appendActivity(
          options,
          "library.scan.review",
          "warning",
          `Review required for ${group.title} (${matches.length} exact TMDB matches)`,
          review.id,
          { reviewId: review.id, candidateCount: review.candidates.length },
        );
        continue;
      }
      const match = matches[0]!;
      let media = options.repositories.media.getByTmdb(
        group.kind,
        match.tmdbId,
      );
      media ??= options.repositories.media.create({
        kind: group.kind,
        tmdbId: match.tmdbId,
        parentId: null,
        seasonNumber: null,
        episodeNumber: null,
        title: match.title,
        year: match.year,
        posterUrl: match.posterPath
          ? `https://image.tmdb.org/t/p/w500/${match.posterPath.replace(/^\//, "")}`
          : null,
        status: "available",
        monitorPolicy: "none",
        releaseDate: match.releaseDate
          ? new Date(`${match.releaseDate}T00:00:00.000Z`).toISOString()
          : null,
        metadata: { imported: true, overview: match.overview },
      });
      importRecordedFiles({
        media,
        files: group.files.map((file) => ({
          path: file.absolutePath,
          sizeBytes: file.sizeBytes,
        })),
        repositories: options.repositories,
      });
      imported += 1;
    }
  }
  appendActivity(
    options,
    "library.scan.completed",
    "success",
    `Library scan imported ${imported} titles and queued ${reviews} for review`,
    null,
    { imported, reviews },
  );
  options.events.publish("library.changed", { imported, reviews });
}

interface ScanGroupFile {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  kind: "movie" | "series";
}

interface ScanGroup {
  kind: "movie" | "series";
  title: string;
  year: number | null;
  files: ScanGroupFile[];
}

function groupScanFiles(files: ScanGroupFile[]): Map<string, ScanGroup> {
  const groups = new Map<string, ScanGroup>();
  for (const file of files) {
    const firstSegment =
      file.relativePath.split(/[\\/]/)[0] ?? basename(file.absolutePath);
    const base = firstSegment.replace(/\.[^.]+$/, "");
    const yearMatch = /(?:^|\s|\()((?:19|20)\d{2})(?:\)|\s|$)/.exec(base);
    const year = yearMatch ? Number(yearMatch[1]) : null;
    const title = base
      .replace(/\s*\((?:19|20)\d{2}\)\s*/, " ")
      .replace(/[._]+/g, " ")
      .trim();
    const key = `${file.kind}:${normalizeTitle(title)}:${year ?? ""}`;
    const group = groups.get(key) ?? {
      kind: file.kind,
      title,
      year,
      files: [],
    };
    group.files.push(file);
    groups.set(key, group);
  }
  return groups;
}

function normalizeTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\d]+/gi, " ")
    .trim()
    .toLowerCase();
}

function mediaStateForDownload(
  state: string,
): "queued" | "downloading" | "organizing" | "available" | "failed" | null {
  if (state === "queued" || state === "paused") return "queued";
  if (state === "downloading" || state === "checking" || state === "seeding") {
    return "downloading";
  }
  if (state === "organizing") return "organizing";
  if (state === "completed") return "available";
  if (state === "failed") return "failed";
  return null;
}

function updateMediaTreeState(
  mediaId: string,
  state: AcquisitionState,
  repositories: Repositories,
): void {
  const item = repositories.media.updateState(mediaId, state);
  if (!item) return;
  let parentId = item.parentId;
  while (parentId) {
    const parent = repositories.media.get(parentId);
    if (!parent) return;
    repositories.media.updateState(
      parent.id,
      aggregateChildAcquisitionState(repositories.media.children(parent.id)),
    );
    parentId = parent.parentId;
  }
}

function markOrganizedEpisodes(
  mediaId: string,
  sourcePaths: readonly string[],
  repositories: Repositories,
): void {
  const item = repositories.media.get(mediaId);
  if (!item || item.kind !== "season") return;
  const episodes = organizedEpisodeNumbers(sourcePaths, item.seasonNumber);
  for (const episode of repositories.media.children(item.id)) {
    if (
      episode.kind === "episode" &&
      episode.episodeNumber !== null &&
      episodes.has(episode.episodeNumber)
    ) {
      repositories.media.updateState(episode.id, "available");
    }
  }
}

function jobDownloadId(payload: unknown): string {
  return jobString(payload, "downloadId");
}

function jobMediaId(payload: unknown): string {
  return jobString(payload, "mediaId");
}

function jobString(payload: unknown, key: string): string {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !(key in payload) ||
    typeof payload[key as keyof typeof payload] !== "string"
  ) {
    throw new TypeError(`Job payload has no ${key}`);
  }
  return payload[key as keyof typeof payload] as string;
}

function jobRoots(payload: unknown): string[] {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("roots" in payload) ||
    !Array.isArray(payload.roots) ||
    !payload.roots.every((root) => typeof root === "string")
  ) {
    throw new TypeError("Library scan job has invalid roots");
  }
  return payload.roots;
}

function appendActivity(
  options: AcquisitionRuntimeOptions,
  type: string,
  level: "info" | "success" | "warning" | "error",
  message: string,
  entityId: string | null,
  data: Record<string, unknown> = {},
): void {
  const event = options.repositories.activity.append({
    type,
    level,
    message,
    entityType: entityId ? "media" : null,
    entityId,
    data,
  });
  options.events.publish("activity.created", { id: event.id });
}
