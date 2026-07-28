import type { Clock } from "../core";

import { describe, expect, test } from "bun:test";

import { updateMediaTreeState } from "./acquisition-runtime";
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
