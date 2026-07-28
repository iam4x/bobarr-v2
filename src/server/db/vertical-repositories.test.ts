import type { Clock } from "../core";

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { createRepositories, openBackendDatabase } from ".";
import {
  ActivityQuerySchema,
  CreateDownloadInputSchema,
  CreateLibraryFileInputSchema,
  CreateLibraryItemRequestSchema,
  DownloadPatchSchema,
  MetadataCacheEntrySchema,
  ReleaseCandidateInputSchema,
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

describe("core vertical-slice persistence", () => {
  test("applies the checked-in Drizzle bootstrap migration", () => {
    const sqlite = new Database(":memory:");
    try {
      sqlite.exec("PRAGMA foreign_keys = ON");
      migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
      const tables = sqlite
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map((row) => row.name);
      expect(tables).toContain("media_items");
      expect(tables).toContain("release_candidates");
      expect(tables).toContain("downloads");
      expect(tables).toContain("library_files");
      expect(tables).toContain("activity_events");
      expect(tables).toContain("metadata_cache");
      expect(tables).toContain("library_scan_reviews");
    } finally {
      sqlite.close();
    }
  });

  test("migrates a fresh database and persists a cascading media hierarchy", async () => {
    const clock = new MutableClock(new Date("2026-07-21T12:00:00.000Z"));
    const database = await openBackendDatabase(":memory:");
    try {
      const repositories = createRepositories(database, clock);
      expect(database.migrationVersion).toBe(5);

      const series = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "series",
          tmdbId: 1_234,
          title: "Example Series",
          monitorPolicy: "future",
        }),
      );
      const season = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "season",
          tmdbId: 2_345,
          parentId: series.id,
          seasonNumber: 1,
          title: "Season 1",
          monitorPolicy: "all",
        }),
      );
      const episode = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "episode",
          tmdbId: 3_456,
          parentId: season.id,
          seasonNumber: 1,
          episodeNumber: 2,
          title: "The Second Episode",
        }),
      );

      expect(repositories.media.getByTmdb("series", 1_234)?.id).toBe(series.id);
      expect(
        repositories.media.children(series.id).map((item) => item.id),
      ).toEqual([season.id]);
      expect(
        repositories.media.children(season.id).map((item) => item.id),
      ).toEqual([episode.id]);
      expect(
        repositories.media.updateState(episode.id, "available")
          ?.acquisitionState,
      ).toBe("available");
      expect(
        repositories.media.updateMonitorPolicy(series.id, "selected")
          ?.monitorPolicy,
      ).toBe("selected");

      expect(repositories.media.delete(series.id)).toBe(true);
      expect(repositories.media.count()).toBe(0);
    } finally {
      database.close();
    }
  });

  test("lists bounded recommendation sources with cursor wrapping", async () => {
    const clock = new MutableClock(new Date("2026-07-21T12:00:00.000Z"));
    const database = await openBackendDatabase(":memory:");
    try {
      const repositories = createRepositories(database, clock);
      const oldest = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "movie",
          tmdbId: 101,
          title: "Oldest matched movie",
          monitorPolicy: "none",
        }),
      );
      clock.advance(1_000);
      const newestA = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "movie",
          tmdbId: 102,
          title: "Newest matched movie A",
        }),
      );
      const newestB = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "movie",
          tmdbId: 103,
          title: "Newest matched movie B",
          monitorPolicy: "none",
        }),
      );
      repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "movie",
          tmdbId: null,
          title: "Unmatched movie",
        }),
      );
      const series = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "series",
          tmdbId: 201,
          title: "Matched series",
        }),
      );
      repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "movie",
          tmdbId: 104,
          parentId: series.id,
          title: "Nested movie-shaped record",
        }),
      );

      const newest = [newestA, newestB].sort((left, right) =>
        right.id.localeCompare(left.id),
      );
      const expected = [...newest, oldest];
      const firstPage = repositories.media.recommendationSources({
        kind: "movie",
        limit: 2,
        cursor: 0,
      });
      expect(firstPage.total).toBe(3);
      expect(firstPage.items.map((item) => item.id)).toEqual(
        expected.slice(0, 2).map((item) => item.id),
      );

      const wrapped = repositories.media.recommendationSources({
        kind: "movie",
        limit: 10,
        cursor: 5,
      });
      expect(wrapped.items.map((item) => item.id)).toEqual([
        oldest.id,
        ...newest.map((item) => item.id),
      ]);
      expect(new Set(wrapped.items.map((item) => item.id)).size).toBe(3);
      expect(
        wrapped.items
          .filter((item) => item.monitorPolicy === "none")
          .map((item) => item.id),
      ).toEqual([oldest.id, newestB.id]);

      expect(
        repositories.media.recommendationSources({
          kind: "series",
          limit: 4,
          cursor: 8,
        }),
      ).toMatchObject({ items: [{ id: series.id }], total: 1 });
    } finally {
      database.close();
    }
  });

  test("keeps release sources protected and persists acquisition lifecycle records", async () => {
    const clock = new MutableClock(new Date("2026-07-21T12:00:00.000Z"));
    const database = await openBackendDatabase(":memory:");
    try {
      const repositories = createRepositories(database, clock);
      const media = repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "movie",
          tmdbId: 999,
          title: "Example Movie",
        }),
      );
      const release = repositories.releases.create({
        ...ReleaseCandidateInputSchema.parse({
          mediaId: media.id,
          tmdbId: 999,
          mediaKind: "movie",
          title: "Example.Movie.2026.1080p.WEB-DL",
          indexer: "example-indexer",
          sizeBytes: 4_000_000_000,
          seeders: 42,
          leechers: 3,
          publishedAt: clock.now().toISOString(),
          quality: "1080p",
          score: 125,
          eligible: true,
          reasons: ["preferred quality"],
        }),
        protectedSourcePayload: "sealed:magnet-with-private-passkey",
        ttlSeconds: 60,
      });

      expect(release.id).toMatch(/^rel_[A-Za-z0-9_-]{32,}$/);
      expect("protectedSourcePayload" in release).toBe(false);
      expect(
        repositories.releases.resolve(release.id)?.protectedSourcePayload,
      ).toBe("sealed:magnet-with-private-passkey");

      const download = repositories.downloads.create(
        CreateDownloadInputSchema.parse({
          mediaId: media.id,
          releaseCandidateId: release.id,
          title: release.title,
          externalId: "transmission-hash",
          totalBytes: release.sizeBytes,
        }),
      );
      const completed = repositories.downloads.update(
        download.id,
        DownloadPatchSchema.parse({
          state: "completed",
          progress: 100,
          downloadedBytes: release.sizeBytes,
          downloadRate: 0,
          uploadRate: 512,
        }),
      );
      expect(completed?.completedAt).toBe(clock.now().toISOString());
      expect(
        repositories.downloads.getByExternalId(
          "transmission",
          "transmission-hash",
        )?.id,
      ).toBe(download.id);

      const file = repositories.libraryFiles.upsert(
        CreateLibraryFileInputSchema.parse({
          mediaId: media.id,
          downloadId: download.id,
          path: "/library/movies/Example Movie (2026)/Example Movie.mkv",
          sizeBytes: release.sizeBytes,
          quality: "1080p",
          videoCodec: "x265",
          audioCodec: "eac3",
          strategy: "hardlink",
        }),
      );
      expect(repositories.libraryFiles.listForMedia(media.id)).toEqual([file]);
      expect(repositories.libraryFiles.get(file.id)).toEqual(file);
      expect(repositories.libraryFiles.get("missing-file")).toBeUndefined();

      const activity = repositories.activity.append({
        type: "download.organized",
        level: "success",
        message: "Download organized into the library",
        entityType: "download",
        entityId: download.id,
        data: { mediaId: media.id },
      });
      expect(
        repositories.activity.list(
          ActivityQuerySchema.parse({ level: "success" }),
        ).events,
      ).toEqual([activity]);

      const cacheEntry = MetadataCacheEntrySchema.parse({
        provider: "tmdb",
        kind: "movie",
        externalId: "999",
        locale: "en-US",
        value: { title: "Example Movie" },
        etag: "etag-1",
        fetchedAt: clock.now().toISOString(),
        expiresAt: new Date(clock.now().getTime() + 30_000).toISOString(),
      });
      repositories.metadataCache.upsert(cacheEntry);
      expect(repositories.metadataCache.get(cacheEntry)?.value).toEqual({
        title: "Example Movie",
      });

      clock.advance(61_000);
      expect(repositories.releases.get(release.id)).toBeUndefined();
      expect(repositories.releases.purgeExpired()).toBe(1);
      expect(
        repositories.downloads.get(download.id)?.releaseCandidateId,
      ).toBeNull();
      expect(repositories.metadataCache.get(cacheEntry)).toBeUndefined();
      expect(
        repositories.metadataCache.get(cacheEntry, { allowStale: true })?.etag,
      ).toBe("etag-1");
      expect(repositories.metadataCache.purgeExpired()).toBe(1);
    } finally {
      database.close();
    }
  });
});
