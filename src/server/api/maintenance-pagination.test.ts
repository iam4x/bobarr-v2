import type { CatalogDetails, TmdbClient } from "../integrations";

import { describe, expect, test } from "bun:test";

import { synchronizeAllMediaStates } from "./acquisition-runtime";
import { enqueueMissingMedia, refreshAllMetadata } from "./initialize";
import {
  CreateDownloadInputSchema,
  CreateLibraryItemRequestSchema,
} from "../../contracts";
import { createRepositories, openBackendDatabase } from "../db";
import { createSqliteJobQueue } from "../jobs";

const OVER_PAGE_LIMIT = 101;

describe("maintenance pagination", () => {
  test("refreshes metadata for every item when the library exceeds one page", async () => {
    const database = await openBackendDatabase(":memory:");
    const queue = createSqliteJobQueue({ database: ":memory:" });
    try {
      const repositories = createRepositories(database);
      const idsByTmdb = new Map<number, string>();
      for (let index = 0; index < OVER_PAGE_LIMIT; index += 1) {
        const tmdbId = 10_000 + index;
        const item = repositories.media.create(
          CreateLibraryItemRequestSchema.parse({
            kind: "movie",
            tmdbId,
            title: `Original ${tmdbId}`,
          }),
        );
        idsByTmdb.set(tmdbId, item.id);
      }

      const refreshed = new Set<number>();
      let heartbeats = 0;
      const client = {
        async details(mediaType: "movie" | "tv", tmdbId: number) {
          refreshed.add(tmdbId);
          return catalogDetails(mediaType, tmdbId);
        },
      } as TmdbClient;

      await refreshAllMetadata({
        repositories,
        queue,
        client,
        language: "en",
        signal: new AbortController().signal,
        heartbeat: async () => {
          heartbeats += 1;
        },
      });

      expect(refreshed.size).toBe(OVER_PAGE_LIMIT);
      expect(heartbeats).toBe(OVER_PAGE_LIMIT);
      for (const [tmdbId, id] of idsByTmdb) {
        expect(repositories.media.get(id)?.title).toBe(`Updated ${tmdbId}`);
      }
    } finally {
      queue.close();
      database.close();
    }
  });

  test("enqueues every missing item when the result exceeds one page", async () => {
    const database = await openBackendDatabase(":memory:");
    const queue = createSqliteJobQueue({ database: ":memory:" });
    try {
      const repositories = createRepositories(database);
      const mediaIds = new Set<string>();
      for (let index = 0; index < OVER_PAGE_LIMIT; index += 1) {
        const item = repositories.media.create(
          CreateLibraryItemRequestSchema.parse({
            kind: "movie",
            tmdbId: 20_000 + index,
            title: `Missing ${index}`,
            status: "missing",
          }),
        );
        mediaIds.add(item.id);
      }

      await enqueueMissingMedia(queue, repositories);

      expect(await queue.count({ types: ["media.acquire.v1"] })).toBe(
        OVER_PAGE_LIMIT,
      );
      const jobs = await queue.list({
        types: ["media.acquire.v1"],
        limit: OVER_PAGE_LIMIT + 1,
      });
      const queuedIds = new Set(
        jobs.map((job) =>
          typeof job.payload === "object" &&
          job.payload !== null &&
          "mediaId" in job.payload
            ? job.payload.mediaId
            : null,
        ),
      );
      for (const id of mediaIds) expect(queuedIds.has(id)).toBe(true);
    } finally {
      queue.close();
      database.close();
    }
  });

  test("retries only episodes marked for incremental acquisition", async () => {
    const database = await openBackendDatabase(":memory:");
    const queue = createSqliteJobQueue({ database: ":memory:" });
    try {
      const repositories = createRepositories(database);
      const series = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "series",
          tmdbId: 25_000,
          title: "Incremental Series",
          status: "available",
          monitorPolicy: "selected",
        }),
      );
      const season = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "season",
          tmdbId: 25_001,
          parentId: series.id,
          seasonNumber: 1,
          title: "Season 1",
          status: "available",
          monitorPolicy: "selected",
        }),
      );
      const initialEpisode = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "episode",
          tmdbId: 25_002,
          parentId: season.id,
          seasonNumber: 1,
          episodeNumber: 1,
          title: "Initial episode",
          status: "missing",
          monitorPolicy: "selected",
          metadata: { incrementalAcquisition: false },
        }),
      );
      const incrementalEpisode = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "episode",
          tmdbId: 25_003,
          parentId: season.id,
          seasonNumber: 1,
          episodeNumber: 2,
          title: "Newly aired episode",
          status: "missing",
          monitorPolicy: "selected",
          metadata: { incrementalAcquisition: true },
        }),
      );

      await enqueueMissingMedia(queue, repositories);

      const queuedMediaIds = new Set(
        (await queue.list({ types: ["media.acquire.v1"] })).map((job) =>
          typeof job.payload === "object" &&
          job.payload !== null &&
          "mediaId" in job.payload
            ? job.payload.mediaId
            : null,
        ),
      );
      expect(queuedMediaIds.has(initialEpisode.id)).toBe(false);
      expect(queuedMediaIds.has(incrementalEpisode.id)).toBe(true);
    } finally {
      queue.close();
      database.close();
    }
  });

  test("synchronizes media state from every download beyond one page", async () => {
    const database = await openBackendDatabase(":memory:");
    try {
      const repositories = createRepositories(database);
      const mediaIds: string[] = [];
      for (let index = 0; index < OVER_PAGE_LIMIT; index += 1) {
        const media = repositories.media.create(
          CreateLibraryItemRequestSchema.parse({
            kind: "movie",
            tmdbId: 30_000 + index,
            title: `Downloading ${index}`,
            status: "missing",
          }),
        );
        mediaIds.push(media.id);
        repositories.downloads.create(
          CreateDownloadInputSchema.parse({
            mediaId: media.id,
            title: `Download ${index}`,
            state: "downloading",
          }),
        );
      }

      synchronizeAllMediaStates(repositories);

      for (const id of mediaIds) {
        expect(repositories.media.get(id)?.acquisitionState).toBe(
          "downloading",
        );
      }
    } finally {
      database.close();
    }
  });

  test("uses the newest download when a media item has retry history", async () => {
    const database = await openBackendDatabase(":memory:");
    try {
      let timestamp = Date.parse("2026-07-21T00:00:00.000Z");
      const repositories = createRepositories(database, {
        now() {
          timestamp += 1;
          return new Date(timestamp);
        },
      });
      const media = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "movie",
          tmdbId: 40_000,
          title: "Replacement",
          status: "missing",
        }),
      );
      repositories.downloads.create(
        CreateDownloadInputSchema.parse({
          mediaId: media.id,
          title: "Old failed attempt",
          state: "failed",
        }),
      );
      repositories.downloads.create(
        CreateDownloadInputSchema.parse({
          mediaId: media.id,
          title: "Current attempt",
          state: "downloading",
        }),
      );

      synchronizeAllMediaStates(repositories);

      expect(repositories.media.get(media.id)?.acquisitionState).toBe(
        "downloading",
      );
    } finally {
      database.close();
    }
  });
});

function catalogDetails(
  mediaType: "movie" | "tv",
  tmdbId: number,
): CatalogDetails {
  return {
    mediaType,
    tmdbId,
    title: `Updated ${tmdbId}`,
    originalTitle: `Updated ${tmdbId}`,
    overview: "Updated overview",
    originalLanguage: "en",
    releaseDate: "2026-01-01",
    year: 2026,
    posterPath: null,
    backdropPath: null,
    genreIds: [],
    popularity: 1,
    voteAverage: 8,
    voteCount: 1,
    genres: [],
    runtimeMinutes: 90,
    status: "Released",
    tagline: null,
    homepage: null,
    externalId: null,
    numberOfSeasons: null,
    numberOfEpisodes: null,
  };
}
