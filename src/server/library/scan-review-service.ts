import type { ScanReview } from "../../contracts";
import type { Repositories } from "../db";
import type { EventHub } from "../events";
import type { TmdbClient } from "../integrations";
import type { Stats } from "node:fs";

import { lstat, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { importRecordedFiles } from "./importer";
import { isPathContained } from "./paths";
import {
  expandStoragePathAliases,
  isWithinStoragePaths,
  storageRootAliases,
  type StorageRootAlias,
} from "./volume-paths";
import { AppError, conflict, notFound } from "../core";
import { libraryRoots } from "../storage";

export interface ScanReviewServiceOptions {
  repositories: Repositories;
  tmdb: () => Promise<TmdbClient>;
  events?: EventHub;
  transferringPaths?: (changedSince?: number) => readonly string[];
}

export interface ScanReviewService {
  resolve(
    id: string,
    tmdbId: number,
    signal?: AbortSignal,
    createdByUserId?: number,
  ): Promise<ScanReview>;
  dismiss(id: string): ScanReview;
}

export function createScanReviewService(
  options: ScanReviewServiceOptions,
): ScanReviewService {
  return {
    async resolve(id, tmdbId, signal, createdByUserId) {
      const review = options.repositories.scanReviews.get(id);
      if (review === undefined) throw notFound("Scan review not found");
      if (review.status === "resolved") {
        if (review.resolvedTmdbId === tmdbId) return review;
        throw conflict("Scan review was resolved with another TMDB title");
      }
      if (review.status === "dismissed") {
        throw conflict("Dismissed scan reviews cannot be resolved");
      }
      const startedAt = Date.now();
      signal?.throwIfAborted();
      const settings = options.repositories.settings.ensureDefaults().settings;
      const configuredRoots = libraryRoots(settings.storage, review.kind).map(
        (item) => item.path,
      );
      const rootAliases = await storageRootAliases(configuredRoots);
      const root = await verifiedRoot(configuredRoots, review.rootPath);
      const reviewPaths = review.files.map((file) => resolve(file.path));
      assertPathsAvailable(
        reviewPaths,
        options.transferringPaths,
        rootAliases,
        startedAt,
      );
      const files = await Promise.all(
        review.files.map(async (file) => {
          signal?.throwIfAborted();
          const recordedPath = resolve(file.path);
          if (!isPathContained(root, recordedPath)) {
            throw conflict(
              "A recorded library file escapes its configured root",
            );
          }
          let pathInfo: Stats;
          try {
            pathInfo = await lstat(recordedPath);
          } catch (error) {
            throw reviewConflict(
              `A recorded library file is no longer available: ${file.path}`,
              error,
            );
          }
          if (!pathInfo.isFile() && !pathInfo.isSymbolicLink()) {
            throw conflict("A recorded library path is no longer a file");
          }
          const fileInfo = await stat(recordedPath);
          if (!fileInfo.isFile()) {
            throw conflict("A recorded library path is no longer a file");
          }
          if (fileInfo.size !== file.sizeBytes) {
            throw conflict(
              "A recorded library file changed after the scan review was created",
            );
          }
          return {
            path: recordedPath,
            sizeBytes: fileInfo.size,
            identity: fileIdentity(pathInfo, fileInfo),
          };
        }),
      );
      assertPathsAvailable(
        reviewPaths,
        options.transferringPaths,
        rootAliases,
        startedAt,
      );

      const client = await options.tmdb();
      const details = await client.details(
        review.kind === "movie" ? "movie" : "tv",
        tmdbId,
        { language: settings.locale.language, signal },
      );
      if (details.tmdbId !== tmdbId) {
        throw conflict("TMDB returned a different title than the selected one");
      }
      const unchanged = await Promise.all(
        files.map(async (file) => {
          signal?.throwIfAborted();
          try {
            const [pathInfo, fileInfo] = await Promise.all([
              lstat(file.path),
              stat(file.path),
            ]);
            return sameFileIdentity(
              file.identity,
              fileIdentity(pathInfo, fileInfo),
            );
          } catch {
            return false;
          }
        }),
      );
      assertPathsAvailable(
        reviewPaths,
        options.transferringPaths,
        rootAliases,
        startedAt,
      );
      if (unchanged.some((value) => !value)) {
        throw conflict(
          "A recorded library file changed while the scan review was being resolved",
        );
      }

      const importedMetadata = {
        imported: true,
        scanReviewId: review.id,
        overview: details.overview,
        originalTitle: details.originalTitle,
        backdropPath: details.backdropPath,
        genres: details.genres,
        voteAverage: details.voteAverage,
        voteCount: details.voteCount,
        numberOfSeasons: details.numberOfSeasons,
        numberOfEpisodes: details.numberOfEpisodes,
      };
      let media = options.repositories.media.getByTmdb(review.kind, tmdbId);
      if (media) {
        media =
          options.repositories.media.updateMetadata(media.id, {
            title: details.title,
            year: details.year,
            posterUrl: imageUrl(details.posterPath) ?? media.posterUrl,
            releaseDate: toIsoReleaseDate(details.releaseDate),
            metadata: { ...media.metadata, ...importedMetadata },
          }) ?? media;
      } else {
        media = options.repositories.media.create({
          kind: review.kind,
          tmdbId,
          parentId: null,
          ...(createdByUserId === undefined ? {} : { createdByUserId }),
          seasonNumber: null,
          episodeNumber: null,
          title: details.title,
          year: details.year,
          posterUrl: imageUrl(details.posterPath),
          status: "available",
          monitorPolicy: "none",
          releaseDate: toIsoReleaseDate(details.releaseDate),
          metadata: importedMetadata,
        });
      }
      importRecordedFiles({
        media,
        files: files.map((file) => ({
          path: file.path,
          sizeBytes: file.sizeBytes,
        })),
        repositories: options.repositories,
      });

      const resolved = options.repositories.scanReviews.resolve(
        review.id,
        tmdbId,
        media.id,
      );
      if (resolved === undefined) {
        const current = options.repositories.scanReviews.get(review.id);
        if (
          current?.status === "resolved" &&
          current.resolvedTmdbId === tmdbId
        ) {
          return current;
        }
        throw conflict("Scan review changed while it was being resolved");
      }
      const activity = options.repositories.activity.append({
        type: "library.scan.review-resolved",
        level: "success",
        message: `Imported ${details.title} from scan review`,
        entityType: "media",
        entityId: media.id,
        data: { reviewId: review.id, tmdbId },
      });
      options.events?.publish("activity.created", { id: activity.id });
      options.events?.publish("library.changed", {
        id: media.id,
        reviewId: review.id,
      });
      return resolved;
    },

    dismiss(id) {
      const review = options.repositories.scanReviews.get(id);
      if (review === undefined) throw notFound("Scan review not found");
      if (review.status === "dismissed") return review;
      if (review.status === "resolved") {
        throw conflict("Resolved scan reviews cannot be dismissed");
      }
      const dismissed = options.repositories.scanReviews.dismiss(id);
      if (dismissed === undefined) {
        throw conflict("Scan review changed while it was being dismissed");
      }
      options.events?.publish("library.changed", { reviewId: id });
      return dismissed;
    },
  };
}

interface FileIdentity {
  entry: ComparableStats;
  target: ComparableStats;
}

type ComparableStats = Pick<Stats, "dev" | "ino" | "size" | "mtimeMs">;

function assertPathsAvailable(
  paths: readonly string[],
  transferring: ((changedSince?: number) => readonly string[]) | undefined,
  roots: readonly StorageRootAlias[],
  startedAt: number,
): void {
  const transferPaths = expandStoragePathAliases(
    transferring?.(startedAt) ?? [],
    roots,
  );
  if (paths.some((path) => isWithinStoragePaths(path, transferPaths, roots))) {
    throw conflict(
      "A recorded library file is being moved between storage volumes",
    );
  }
}

function fileIdentity(
  pathInfo: ComparableStats,
  targetInfo: ComparableStats,
): FileIdentity {
  return {
    entry: comparableStats(pathInfo),
    target: comparableStats(targetInfo),
  };
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    sameStats(left.entry, right.entry) && sameStats(left.target, right.target)
  );
}

function comparableStats(stats: ComparableStats): ComparableStats {
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

function sameStats(left: ComparableStats, right: ComparableStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

async function verifiedRoot(
  configuredRoots: readonly string[],
  recordedRoot: string,
): Promise<string> {
  let recorded: string;
  try {
    recorded = await realpath(recordedRoot);
  } catch (error) {
    throw reviewConflict("The configured library root is unavailable", error);
  }
  for (const configuredRoot of configuredRoots) {
    try {
      const configured = await realpath(configuredRoot);
      if (configured === recorded) return configured;
    } catch {
      continue;
    }
  }
  throw conflict("The scan review belongs to a different library root");
}

function imageUrl(path: string | null): string | null {
  return path
    ? `https://image.tmdb.org/t/p/w500/${path.replace(/^\//, "")}`
    : null;
}

function toIsoReleaseDate(value: string | null): string | null {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

function reviewConflict(message: string, cause: unknown): AppError {
  return new AppError({ code: "conflict", message, status: 409, cause });
}
