import type { StorageVolume } from "../../contracts";
import type { Clock } from "../core";
import type { IntegrationResolver } from "./integration-resolver";

import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAcquisitionRuntime,
  scanTargetsFromJobPayload,
  updateMediaTreeState,
} from "./acquisition-runtime";
import { CreateLibraryItemRequestSchema } from "../../contracts";
import { createEncryptionKey, parseBackendConfig } from "../config";
import { createRepositories, openBackendDatabase } from "../db";
import { saveVolumeTransfer } from "../db/volume-transfers";
import { createEventHub } from "../events";
import { createTmdbClient } from "../integrations/tmdb";
import { createJobWorker, createSqliteJobQueue } from "../jobs";

test("a scan imports unrelated movies while excluding an active transfer and staging tree", async () => {
  let searches = 0;
  const fixture = await createScanFixture(async () => {
    searches += 1;
    return tmdbSearchResponse({ id: 2002, title: "Other", year: 2025 });
  });
  try {
    const activeFolder = join(fixture.volumeA.moviesPath, "Active (2024)");
    const activeFile = join(activeFolder, "Active.mkv");
    const otherFolder = join(fixture.volumeA.moviesPath, "Other (2025)");
    const otherFile = join(otherFolder, "Other.mkv");
    const stagingRoot = join(
      fixture.volumeA.moviesPath,
      ".bobarr-volume-organize",
      "transfer",
    );
    await mkdir(activeFolder, { recursive: true });
    await mkdir(otherFolder, { recursive: true });
    await mkdir(stagingRoot, { recursive: true });
    await Bun.write(activeFile, "active");
    await Bun.write(otherFile, "other");
    await Bun.write(join(stagingRoot, "staged.mkv"), "staged");
    startVolumeTransfer(fixture, [activeFolder, activeFile, stagingRoot]);

    const job = await runMovieScan(fixture, fixture.volumeA.moviesPath);

    expect(job).toMatchObject({ state: "completed" });
    expect(searches).toBe(1);
    expect(fixture.repositories.libraryFiles.listPaths()).toEqual([
      await realpath(otherFile),
    ]);
    expect(
      fixture.repositories.media
        .list({ limit: 100, offset: 0 })
        .items.map((item) => item.title),
    ).toEqual(["Other"]);
    expect(
      fixture.repositories.scanReviews.list({
        status: "pending",
        kind: "movie",
        limit: 50,
        offset: 0,
      }).total,
    ).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("a scan skips a group whose transfer completes during metadata lookup", async () => {
  let activeFolder = "";
  let activeFile = "";
  const fixture: Awaited<ReturnType<typeof createScanFixture>> =
    await createScanFixture(async () => {
      const transfer = startVolumeTransfer(fixture, [activeFolder, activeFile]);
      saveVolumeTransfer(fixture.database, {
        ...transfer,
        stage: "complete",
      });
      return tmdbSearchResponse({ id: 1234, title: "Example", year: 2024 });
    });
  try {
    activeFolder = join(fixture.volumeA.moviesPath, "Example (2024)");
    activeFile = join(activeFolder, "Example.mkv");
    await mkdir(activeFolder, { recursive: true });
    await Bun.write(activeFile, "media");

    const job = await runMovieScan(fixture, fixture.volumeA.moviesPath);

    expect(job).toMatchObject({ state: "completed" });
    expect(fixture.repositories.libraryFiles.listPaths()).toEqual([]);
    expect(
      fixture.repositories.media.list({ limit: 100, offset: 0 }).total,
    ).toBe(0);
  } finally {
    await fixture.close();
  }
});

async function createScanFixture(
  fetcher: NonNullable<Parameters<typeof createTmdbClient>[0]["fetch"]>,
) {
  const root = await mkdtemp(join(tmpdir(), "bobarr-scan-moving-"));
  const database = await openBackendDatabase(":memory:");
  const repositories = createRepositories(database);
  const queue = createSqliteJobQueue({ database: database.sqlite });
  const events = createEventHub();
  const volumeA: StorageVolume = {
    id: "disk-a",
    label: "A",
    downloadsPath: join(root, "a/downloads"),
    moviesPath: join(root, "a/movies"),
    televisionPath: join(root, "a/tv"),
  };
  const volumeB: StorageVolume = {
    id: "disk-b",
    label: "B",
    downloadsPath: join(root, "b/downloads"),
    moviesPath: join(root, "b/movies"),
    televisionPath: join(root, "b/tv"),
  };
  for (const volume of [volumeA, volumeB]) {
    await mkdir(volume.downloadsPath, { recursive: true });
    await mkdir(volume.moviesPath, { recursive: true });
    await mkdir(volume.televisionPath, { recursive: true });
  }
  repositories.settings.update({
    storage: { volumes: [volumeA, volumeB], organizationStrategy: "copy" },
  });
  const tmdb = createTmdbClient({ apiKey: "fixture", fetch: fetcher });
  const unavailable = async (): Promise<never> => {
    throw new Error("Unexpected integration call");
  };
  const integrations: IntegrationResolver = {
    tmdb: async () => tmdb,
    omdb: unavailable,
    jackett: unavailable,
    transmission: unavailable,
    test: unavailable,
    status: unavailable,
    invalidate() {},
  };
  const runtime = createAcquisitionRuntime({
    config: parseBackendConfig({
      NODE_ENV: "test",
      BOBARR_MASTER_KEY: createEncryptionKey(),
    }),
    database,
    repositories,
    queue,
    events,
    integrations,
  });
  return {
    root,
    database,
    repositories,
    queue,
    events,
    volumeA,
    volumeB,
    worker: createJobWorker({ queue, handlers: runtime.handlers }),
    async close() {
      events.close();
      queue.close();
      database.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

function startVolumeTransfer(
  fixture: Awaited<ReturnType<typeof createScanFixture>>,
  paths: string[],
) {
  const groupKey = `movie:${crypto.randomUUID()}`;
  const transfer = {
    id: crypto.randomUUID(),
    groupKey,
    groupKeys: [groupKey],
    jobId: crypto.randomUUID(),
    title: "Active",
    mediaIds: [],
    destinationVolumeId: fixture.volumeB.id,
    stagingRoot: join(
      fixture.volumeB.moviesPath,
      ".bobarr-volume-organize",
      crypto.randomUUID(),
    ),
    paths,
    files: [],
    libraryFiles: [],
    downloads: [],
    stage: "copying" as const,
  };
  saveVolumeTransfer(fixture.database, transfer);
  return transfer;
}

async function runMovieScan(
  fixture: Awaited<ReturnType<typeof createScanFixture>>,
  path: string,
) {
  const job = await fixture.queue.enqueue({
    type: "library.scan.v1",
    payload: { version: 1, targets: [{ path, kind: "movie" }] },
  });
  await fixture.worker.runOnce();
  return fixture.queue.get(job.id);
}

function tmdbSearchResponse(input: {
  id: number;
  title: string;
  year: number;
}): Response {
  return Response.json({
    page: 1,
    total_pages: 1,
    total_results: 1,
    results: [
      {
        id: input.id,
        media_type: "movie",
        title: input.title,
        release_date: `${input.year}-01-01`,
        overview: "",
        poster_path: null,
      },
    ],
  });
}

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
