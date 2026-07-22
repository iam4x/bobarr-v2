import type { Clock } from "../core";

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRepositories, openBackendDatabase } from ".";
import { CreateLibraryItemRequestSchema } from "../../contracts";

const candidate = {
  tmdbId: 603,
  kind: "movie" as const,
  title: "The Matrix",
  year: 1999,
  posterPath: "/poster.jpg",
  overview: "A hacker discovers the nature of reality.",
};

class FixedClock implements Clock {
  constructor(private readonly value: Date) {}

  now(): Date {
    return new Date(this.value);
  }
}

describe("library scan review persistence", () => {
  test("upserts a stable pending review and preserves its disposition", async () => {
    const database = await openBackendDatabase(":memory:");
    try {
      const repositories = createRepositories(
        database,
        new FixedClock(new Date("2026-07-21T12:00:00.000Z")),
      );
      const input = {
        kind: "movie" as const,
        title: "Matrix",
        year: 1999,
        rootPath: "/media/movies",
        files: [{ path: "/media/movies/Matrix/movie.mkv", sizeBytes: 42 }],
        candidates: [candidate],
      };

      const created = repositories.scanReviews.upsert(input);
      const repeated = repositories.scanReviews.upsert({
        ...input,
        files: [
          ...input.files,
          { path: "/media/movies/Matrix/extras.mp4", sizeBytes: 7 },
        ],
      });
      expect(repeated.id).toBe(created.id);
      expect(repeated.files).toHaveLength(2);
      expect(
        repositories.scanReviews.list({
          status: "pending",
          limit: 50,
          offset: 0,
        }),
      ).toMatchObject({ total: 1 });

      const dismissed = repositories.scanReviews.dismiss(created.id);
      expect(dismissed?.status).toBe("dismissed");
      expect(repositories.scanReviews.dismiss(created.id)).toBeUndefined();
      expect(repositories.scanReviews.upsert(input)).toMatchObject({
        id: created.id,
        status: "dismissed",
      });
    } finally {
      database.close();
    }
  });

  test("links an explicitly resolved review to its imported media", async () => {
    const database = await openBackendDatabase(":memory:");
    try {
      const repositories = createRepositories(database);
      const review = repositories.scanReviews.upsert({
        kind: "movie",
        title: "Matrix",
        year: 1999,
        rootPath: "/media/movies",
        files: [{ path: "/media/movies/Matrix/movie.mkv", sizeBytes: 42 }],
        candidates: [candidate],
      });
      const media = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "movie",
          tmdbId: 603,
          title: "The Matrix",
          status: "available",
          monitorPolicy: "none",
        }),
      );

      expect(
        repositories.scanReviews.resolve(review.id, 603, media.id),
      ).toMatchObject({
        status: "resolved",
        resolvedTmdbId: 603,
        mediaItemId: media.id,
      });
      expect(
        repositories.scanReviews.list({
          status: "resolved",
          limit: 50,
          offset: 0,
        }).total,
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  test("recovers pending review state after reopening SQLite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bobarr-review-db-"));
    const path = join(directory, "bobarr.sqlite");
    try {
      const firstDatabase = await openBackendDatabase(path);
      const created = createRepositories(firstDatabase).scanReviews.upsert({
        kind: "movie",
        title: "Matrix",
        year: 1999,
        rootPath: "/media/movies",
        files: [{ path: "/media/movies/Matrix/movie.mkv", sizeBytes: 42 }],
        candidates: [candidate],
      });
      firstDatabase.close();

      const reopened = await openBackendDatabase(path);
      try {
        expect(reopened.migrationVersion).toBe(5);
        expect(
          createRepositories(reopened).scanReviews.get(created.id),
        ).toMatchObject({
          id: created.id,
          status: "pending",
          candidates: [{ tmdbId: 603 }],
        });
      } finally {
        reopened.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
