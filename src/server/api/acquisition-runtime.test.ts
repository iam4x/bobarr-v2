import type { Clock } from "../core";

import { describe, expect, test } from "bun:test";

import {
  scanTargetsFromJobPayload,
  updateMediaTreeState,
} from "./acquisition-runtime";
import { CreateLibraryItemRequestSchema } from "../../contracts";
import { createRepositories, openBackendDatabase } from "../db";

class FixedClock implements Clock {
  constructor(private readonly current: Date) {}

  now(): Date {
    return new Date(this.current);
  }
}

describe("acquisition media state reconciliation", () => {
  test("stops monitoring a completed season with no upcoming episodes", async () => {
    const now = new Date("2026-07-28T12:00:00.000Z");
    const database = await openBackendDatabase(":memory:");
    try {
      const repositories = createRepositories(database, new FixedClock(now));
      const series = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "series",
          title: "Completed Show",
          monitorPolicy: "selected",
        }),
      );
      const season = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "season",
          parentId: series.id,
          seasonNumber: 1,
          title: "Season 1",
          status: "downloading",
          monitorPolicy: "selected",
        }),
      );
      const firstEpisode = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "episode",
          parentId: season.id,
          seasonNumber: 1,
          episodeNumber: 1,
          title: "Episode 1",
          status: "available",
          monitorPolicy: "selected",
          releaseDate: "2026-07-20T00:00:00.000Z",
        }),
      );
      const finalEpisode = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "episode",
          parentId: season.id,
          seasonNumber: 1,
          episodeNumber: 2,
          title: "Episode 2",
          status: "downloading",
          monitorPolicy: "selected",
          releaseDate: "2026-07-27T00:00:00.000Z",
        }),
      );

      updateMediaTreeState(
        finalEpisode.id,
        "available",
        repositories,
        now.getTime(),
      );

      expect(repositories.media.get(season.id)).toMatchObject({
        acquisitionState: "available",
        monitorPolicy: "none",
      });
      expect(repositories.media.get(firstEpisode.id)).toMatchObject({
        acquisitionState: "available",
        monitorPolicy: "none",
      });
      expect(repositories.media.get(finalEpisode.id)).toMatchObject({
        acquisitionState: "available",
        monitorPolicy: "none",
      });
      expect(repositories.media.get(series.id)).toMatchObject({
        monitorPolicy: "selected",
        acquisitionState: "unmonitored",
      });
    } finally {
      database.close();
    }
  });

  test("keeps monitoring when a season still has an upcoming episode", async () => {
    const now = new Date("2026-07-28T12:00:00.000Z");
    const database = await openBackendDatabase(":memory:");
    try {
      const repositories = createRepositories(database, new FixedClock(now));
      const series = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "series",
          title: "Airing Show",
          monitorPolicy: "selected",
        }),
      );
      const season = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "season",
          parentId: series.id,
          seasonNumber: 1,
          title: "Season 1",
          status: "downloading",
          monitorPolicy: "selected",
        }),
      );
      const downloadedEpisode = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "episode",
          parentId: season.id,
          seasonNumber: 1,
          episodeNumber: 1,
          title: "Episode 1",
          status: "downloading",
          monitorPolicy: "selected",
          releaseDate: "2026-07-27T00:00:00.000Z",
        }),
      );
      repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "episode",
          parentId: season.id,
          seasonNumber: 1,
          episodeNumber: 2,
          title: "Episode 2",
          status: "missing",
          monitorPolicy: "selected",
          releaseDate: "2026-08-04T00:00:00.000Z",
        }),
      );

      updateMediaTreeState(
        downloadedEpisode.id,
        "available",
        repositories,
        now.getTime(),
      );

      expect(repositories.media.get(season.id)).toMatchObject({
        acquisitionState: "missing",
        monitorPolicy: "selected",
      });
      expect(repositories.media.get(downloadedEpisode.id)).toMatchObject({
        acquisitionState: "available",
        monitorPolicy: "selected",
      });
    } finally {
      database.close();
    }
  });
});

describe("library scan payload", () => {
  const storage = {
    organizationStrategy: "hardlink" as const,
    volumes: [
      {
        id: "disk-a",
        label: "Disk A",
        downloadsPath: "/media/downloads",
        moviesPath: "/media/movies",
        televisionPath: "/media/tv",
      },
      {
        id: "disk-b",
        label: "Disk B",
        downloadsPath: "/media-b/downloads",
        moviesPath: "/media-b/movies",
        televisionPath: "/media-b/tv",
      },
    ],
  };

  test("a job with two movie roots both import as movie", () => {
    expect(
      scanTargetsFromJobPayload(
        {
          version: 1,
          targets: [
            { path: "/media/movies", kind: "movie" },
            { path: "/media-b/movies", kind: "movie" },
          ],
        },
        storage,
      ),
    ).toEqual([
      { path: "/media/movies", kind: "movie" },
      { path: "/media-b/movies", kind: "movie" },
    ]);
  });

  test("maps legacy roots through current volumes", () => {
    expect(
      scanTargetsFromJobPayload(
        { version: 1, roots: ["/media/movies", "/media-b/tv"] },
        storage,
      ),
    ).toEqual([
      { path: "/media/movies", kind: "movie" },
      { path: "/media-b/tv", kind: "series" },
    ]);
  });

  test("rejects a legacy root that is not a configured volume", () => {
    expect(() =>
      scanTargetsFromJobPayload({ version: 1, roots: ["/unknown"] }, storage),
    ).toThrow("not a configured volume");
  });
});
