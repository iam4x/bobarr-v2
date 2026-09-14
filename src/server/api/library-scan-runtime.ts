import type { StorageVolume } from "../../contracts";
import type { BackendDatabase, Repositories } from "../db";
import type { EventHub } from "../events";
import type { LibraryRoot } from "../storage";
import type { IntegrationResolver } from "./integration-resolver";

import { stat } from "node:fs/promises";
import { basename } from "node:path";

import { transferringPaths } from "../db/volume-transfers";
import { importRecordedFiles, scanLibrary } from "../library";
import {
  expandStoragePathAliases,
  isWithinStoragePaths,
  storageRootAliases,
} from "../library/volume-paths";

export interface LibraryScanRuntimeOptions {
  database: BackendDatabase;
  repositories: Repositories;
  events: EventHub;
  integrations: Pick<IntegrationResolver, "tmdb">;
}

export async function runLibraryScan(
  payload: unknown,
  signal: AbortSignal,
  heartbeat: () => Promise<void>,
  options: LibraryScanRuntimeOptions,
): Promise<void> {
  const startedAt = Date.now();
  const settings = options.repositories.settings.ensureDefaults().settings;
  const rootAliases = await storageRootAliases(
    settings.storage.volumes.flatMap((volume) => [
      volume.moviesPath,
      volume.televisionPath,
    ]),
  );
  const currentTransferPaths = (): readonly string[] =>
    expandStoragePathAliases(
      transferringPaths(options.database, startedAt),
      rootAliases,
    );
  const targets = scanTargetsFromJobPayload(payload, settings.storage);
  const tmdb = await options.integrations.tmdb();
  let imported = 0;
  let reviews = 0;
  for (const target of targets) {
    signal.throwIfAborted();
    const kind = target.kind;
    const root = target.path;
    const scannedFiles = await scanLibrary({
      root,
      followSymlinks: true,
      ignoredDirectories: [".git", "@eaDir", ".bobarr-volume-organize"],
    });
    const pathsAfterScan = currentTransferPaths();
    const files = scannedFiles.filter(
      (file) =>
        !isWithinStoragePaths(file.absolutePath, pathsAfterScan, rootAliases),
    );
    const groups = groupScanFiles(files.map((file) => ({ ...file, kind })));
    for (const group of groups.values()) {
      signal.throwIfAborted();
      await heartbeat();
      const result = await tmdb.search(group.title, {
        page: 1,
        language: settings.locale.language,
        region: settings.locale.region,
        year: group.year ?? undefined,
        signal,
      });
      const unchangedFiles = await Promise.all(
        group.files.map(async (file) => {
          const info = await stat(file.absolutePath).catch(() => null);
          return (
            info?.isFile() &&
            info.size === file.sizeBytes &&
            info.mtimeMs === file.modifiedAt
          );
        }),
      );
      const pathsBeforeWrite = currentTransferPaths();
      if (
        group.files.some((file) =>
          isWithinStoragePaths(
            file.absolutePath,
            pathsBeforeWrite,
            rootAliases,
          ),
        )
      )
        continue;
      if (unchangedFiles.some((unchanged) => !unchanged)) continue;
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
  modifiedAt: number;
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

export function scanTargetsFromJobPayload(
  payload: unknown,
  storage: { volumes: readonly StorageVolume[] },
): LibraryRoot[] {
  if (typeof payload !== "object" || payload === null) {
    throw new TypeError("Library scan job has invalid roots");
  }
  if ("targets" in payload) {
    return parseScanTargets(payload.targets);
  }
  if (
    !("roots" in payload) ||
    !Array.isArray(payload.roots) ||
    !payload.roots.every((root) => typeof root === "string")
  ) {
    throw new TypeError("Library scan job has invalid roots");
  }
  return payload.roots.map((root) => {
    if (storage.volumes.some((volume) => volume.moviesPath === root)) {
      return { path: root, kind: "movie" as const };
    }
    if (storage.volumes.some((volume) => volume.televisionPath === root)) {
      return { path: root, kind: "series" as const };
    }
    throw new TypeError(
      `Library scan job root is not a configured volume: ${root}`,
    );
  });
}

function parseScanTargets(value: unknown): LibraryRoot[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Library scan job has invalid targets");
  }
  return value.map((target) => {
    if (
      typeof target !== "object" ||
      target === null ||
      !("path" in target) ||
      !("kind" in target) ||
      typeof target.path !== "string" ||
      (target.kind !== "movie" && target.kind !== "series")
    ) {
      throw new TypeError("Library scan job has invalid targets");
    }
    return { path: target.path, kind: target.kind };
  });
}

function appendActivity(
  options: LibraryScanRuntimeOptions,
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
