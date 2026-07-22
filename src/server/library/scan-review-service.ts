import type { ScanReview } from "../../contracts";
import type { Repositories } from "../db";
import type { EventHub } from "../events";
import type { TmdbClient } from "../integrations";

import { lstat, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { importRecordedFiles } from "./importer";
import { isPathContained } from "./paths";
import { AppError, conflict, notFound } from "../core";

export interface ScanReviewServiceOptions {
  repositories: Repositories;
  tmdb: () => Promise<TmdbClient>;
  events?: EventHub;
}

export interface ScanReviewService {
  resolve(
    id: string,
    tmdbId: number,
    signal?: AbortSignal,
  ): Promise<ScanReview>;
  dismiss(id: string): ScanReview;
}

export function createScanReviewService(
  options: ScanReviewServiceOptions,
): ScanReviewService {
  return {
    async resolve(id, tmdbId, signal) {
      const review = options.repositories.scanReviews.get(id);
      if (review === undefined) throw notFound("Scan review not found");
      if (review.status === "resolved") {
        if (review.resolvedTmdbId === tmdbId) return review;
        throw conflict("Scan review was resolved with another TMDB title");
      }
      if (review.status === "dismissed") {
        throw conflict("Dismissed scan reviews cannot be resolved");
      }
      signal?.throwIfAborted();
      const settings = options.repositories.settings.ensureDefaults().settings;
      const configuredRoot =
        review.kind === "movie"
          ? settings.storage.moviesPath
          : settings.storage.televisionPath;
      const root = await verifiedRoot(configuredRoot, review.rootPath);
      const files = await Promise.all(
        review.files.map(async (file) => {
          signal?.throwIfAborted();
          const recordedPath = resolve(file.path);
          if (!isPathContained(root, recordedPath)) {
            throw conflict(
              "A recorded library file escapes its configured root",
            );
          }
          let pathInfo: Awaited<ReturnType<typeof lstat>>;
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
          return { path: recordedPath, sizeBytes: fileInfo.size };
        }),
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
        files,
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

async function verifiedRoot(
  configuredRoot: string,
  recordedRoot: string,
): Promise<string> {
  try {
    const [configured, recorded] = await Promise.all([
      realpath(configuredRoot),
      realpath(recordedRoot),
    ]);
    if (configured !== recorded) {
      throw conflict("The scan review belongs to a different library root");
    }
    return configured;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw reviewConflict("The configured library root is unavailable", error);
  }
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
