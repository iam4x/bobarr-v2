import type { Clock } from "../core";

import { describe, expect, test } from "bun:test";

import { createRepositories, openBackendDatabase } from ".";
import {
  CreateDownloadInputSchema,
  CreateLibraryFileInputSchema,
  CreateLibraryItemRequestSchema,
  DownloadPatchSchema,
} from "../../contracts";

class MutableClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

describe("library card projections", () => {
  test("aggregates descendant files, monitored episodes, and the active download", async () => {
    const clock = new MutableClock(new Date("2026-07-21T12:00:00.000Z"));
    const database = await openBackendDatabase(":memory:");
    try {
      const repositories = createRepositories(database, clock);
      const series = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "series",
          tmdbId: 100,
          title: "Example Series",
        }),
      );
      const season = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "season",
          tmdbId: 101,
          parentId: series.id,
          seasonNumber: 1,
          title: "Season 1",
        }),
      );
      const availableEpisode = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "episode",
          tmdbId: 102,
          parentId: season.id,
          seasonNumber: 1,
          episodeNumber: 1,
          title: "Available tomorrow",
          status: "available",
          releaseDate: "2026-07-22T12:00:00.000Z",
        }),
      );
      repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "episode",
          tmdbId: 103,
          parentId: season.id,
          seasonNumber: 1,
          episodeNumber: 2,
          title: "Not monitored",
          monitorPolicy: "none",
          releaseDate: "2026-07-21T18:00:00.000Z",
        }),
      );
      repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "episode",
          tmdbId: 104,
          parentId: season.id,
          seasonNumber: 1,
          episodeNumber: 3,
          title: "Missing later",
          releaseDate: "2026-07-23T12:00:00.000Z",
        }),
      );

      const active = repositories.downloads.create(
        CreateDownloadInputSchema.parse({
          mediaId: season.id,
          title: "Example.Series.S01",
          state: "downloading",
          totalBytes: 1_000,
          downloadPath: "/media/downloads/active",
        }),
      );
      repositories.downloads.update(
        active.id,
        DownloadPatchSchema.parse({
          state: "downloading",
          progress: 25,
          downloadedBytes: 250,
          totalBytes: 1_000,
          downloadRate: 100,
        }),
      );
      clock.advance(1_000);
      const completed = repositories.downloads.create(
        CreateDownloadInputSchema.parse({
          mediaId: availableEpisode.id,
          title: "Example.Series.S01E01",
          state: "completed",
          totalBytes: 400,
          downloadPath: "/media/downloads/completed",
        }),
      );
      repositories.downloads.update(
        completed.id,
        DownloadPatchSchema.parse({ state: "completed", progress: 100 }),
      );

      repositories.libraryFiles.upsert(
        CreateLibraryFileInputSchema.parse({
          mediaId: season.id,
          downloadId: active.id,
          path: "/media/tv/Example Series/Season 01/episode-1.mkv",
          sizeBytes: 400,
          quality: "1080p",
          videoCodec: null,
          audioCodec: null,
          strategy: "hardlink",
        }),
      );
      repositories.libraryFiles.upsert(
        CreateLibraryFileInputSchema.parse({
          mediaId: availableEpisode.id,
          downloadId: completed.id,
          path: "/media/tv/Example Series/Season 01/episode-2.mkv",
          sizeBytes: 600,
          quality: null,
          videoCodec: null,
          audioCodec: null,
          strategy: "hardlink",
        }),
      );

      const projection = repositories.media
        .cardProjections([series.id])
        .get(series.id);
      expect(projection).toMatchObject({
        rootId: series.id,
        libraryPath: "/media/tv/Example Series/Season 01/episode-1.mkv",
        fileCount: 2,
        totalBytes: 1_000,
        quality: "1080p",
        episodeAvailable: 1,
        episodeTotal: 2,
        nextAirAt: Date.parse("2026-07-22T12:00:00.000Z"),
        download: {
          id: active.id,
          active: true,
          state: "downloading",
          progress: 25,
          downloadPath: "/media/downloads/active",
        },
      });
    } finally {
      database.close();
    }
  });

  test("summarizes acquisition states in one aggregate", async () => {
    const database = await openBackendDatabase(":memory:");
    try {
      const repositories = createRepositories(database);
      for (const [tmdbId, status] of [
        [201, "available"],
        [202, "downloading"],
        [203, "missing"],
        [204, "failed"],
      ] as const) {
        repositories.media.create(
          CreateLibraryItemRequestSchema.parse({
            kind: "movie",
            tmdbId,
            title: `Movie ${tmdbId}`,
            status,
          }),
        );
      }
      expect(repositories.media.summarize({ kind: "movie" })).toEqual({
        total: 4,
        downloaded: 1,
        active: 1,
        missing: 1,
        failed: 1,
      });
    } finally {
      database.close();
    }
  });
});
