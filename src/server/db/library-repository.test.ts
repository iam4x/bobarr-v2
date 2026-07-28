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
});
