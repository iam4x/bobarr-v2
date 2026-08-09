import type { Clock } from "../core";

import { describe, expect, test } from "bun:test";

import { createRepositories, openBackendDatabase } from ".";
import { CreateLibraryItemRequestSchema } from "../../contracts";

class MutableClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

describe("library repository", () => {
  test.each(["movie", "series"] as const)(
    "lists %s library items by date added, newest first",
    async (kind) => {
      const clock = new MutableClock(new Date("2026-07-21T12:00:00.000Z"));
      const database = await openBackendDatabase(":memory:");
      try {
        const repositories = createRepositories(database, clock);
        const older = repositories.library.create(
          CreateLibraryItemRequestSchema.parse({
            kind,
            title: "Older addition",
          }),
        );
        clock.advance(1_000);
        const newer = repositories.library.create(
          CreateLibraryItemRequestSchema.parse({
            kind,
            title: "Newer addition",
          }),
        );

        clock.advance(1_000);
        repositories.library.updateState(older.id, "available");

        const result = repositories.library.list({
          kind,
          limit: 100,
          offset: 0,
        });

        expect(result.items.map((item) => item.id)).toEqual([
          newer.id,
          older.id,
        ]);
      } finally {
        database.close();
      }
    },
  );

  test("filters by availability buckets and sorts by title", async () => {
    const database = await openBackendDatabase(":memory:");
    try {
      const repositories = createRepositories(database);
      const available = repositories.library.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "movie",
          title: "Zulu Available",
          acquisitionState: "available",
          metadata: {
            genres: [{ id: 28, name: "Action" }],
            voteAverage: 8.1,
          },
        }),
      );
      const missing = repositories.library.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "movie",
          title: "Alpha Missing",
          acquisitionState: "missing",
          metadata: {
            genres: [{ id: 18, name: "Drama" }],
            voteAverage: 6.2,
          },
        }),
      );
      repositories.library.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "movie",
          title: "Busy Download",
          acquisitionState: "downloading",
        }),
      );

      const missingPage = repositories.library.list({
        kind: "movie",
        availability: "missing",
        limit: 50,
        offset: 0,
      });
      expect(missingPage.items.map((item) => item.id)).toEqual([missing.id]);
      expect(missingPage.total).toBe(1);

      const activePage = repositories.library.list({
        kind: "movie",
        availability: "active",
        limit: 50,
        offset: 0,
      });
      expect(activePage.total).toBe(1);
      expect(activePage.items[0]?.title).toBe("Busy Download");

      const titlePage = repositories.library.list({
        kind: "movie",
        sort: "title.asc",
        limit: 50,
        offset: 0,
      });
      expect(titlePage.items.map((item) => item.title)).toEqual([
        "Alpha Missing",
        "Busy Download",
        "Zulu Available",
      ]);

      const genrePage = repositories.library.list({
        kind: "movie",
        genreId: 28,
        limit: 50,
        offset: 0,
      });
      expect(genrePage.items.map((item) => item.id)).toEqual([available.id]);

      const ratingPage = repositories.library.list({
        kind: "movie",
        ratingMin: 8,
        sort: "rating.desc",
        limit: 50,
        offset: 0,
      });
      expect(ratingPage.items.map((item) => item.id)).toEqual([available.id]);
    } finally {
      database.close();
    }
  });
});
