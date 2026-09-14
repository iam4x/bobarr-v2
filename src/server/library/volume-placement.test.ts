import type { LibraryItem, StorageVolume } from "../../contracts";
import type { DownloadRepository, TorrentEngine } from "../application/ports";
import type { Repositories } from "../db";

import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDownloadPlacement,
  groupForLibraryFile,
  groupForMedia,
  listLibraryGroups,
} from "./volume-placement";
import { CreateLibraryItemRequestSchema } from "../../contracts";
import { createAcquisitionService } from "../application/acquisition-service";
import {
  candidateRepositoryFromDatabase,
  createFilesystemLibraryOrganizer,
} from "../application/adapters";
import { createAesCandidateCipher } from "../application/candidate-cipher";
import { downloadRepositoryFromDatabase } from "../application/download-repository-adapter";
import { createRepositories, openBackendDatabase } from "../db";
import { withMediaMutation } from "../db/volume-transfers";
import { createSqliteJobQueue } from "../jobs";
import { STORAGE_RESERVE_BYTES } from "../storage";

const VOLUME_A = {
  id: "disk-a",
  label: "Disk A",
  downloadsPath: "/media-a/downloads",
  moviesPath: "/media-a/movies",
  televisionPath: "/media-a/tv",
} satisfies StorageVolume;
const VOLUME_B = {
  id: "disk-b",
  label: "Disk B",
  downloadsPath: "/media-b/downloads",
  moviesPath: "/media-b/movies",
  televisionPath: "/media-b/tv",
} satisfies StorageVolume;
const GIB = 1024n * 1024n * 1024n;

describe("movie and season storage groups", () => {
  test("combines episode, season-pack, and imported series files by season", async () => {
    const fixture = await createFixture();
    try {
      const { repositories } = fixture;
      const series = media(repositories, { kind: "series", title: "Example" });
      const season = media(repositories, {
        kind: "season",
        title: "Season 1",
        parentId: series.id,
        seasonNumber: 1,
      });
      const episode = media(repositories, {
        kind: "episode",
        title: "Episode",
        parentId: season.id,
        seasonNumber: 1,
        episodeNumber: 1,
      });
      recordFile(
        repositories,
        episode,
        "/media-a/tv/Example/Season 01/Example.S01E01.mkv",
      );
      recordFile(
        repositories,
        season,
        "/media-a/tv/Example/Season 01/Example.S01E02E03.mkv",
      );
      recordFile(
        repositories,
        series,
        "/media-a/tv/Example/Season 01/Example.S01E04.mkv",
      );
      recordFile(
        repositories,
        series,
        "/media-b/tv/Example/Season 00/Special.mkv",
      );
      const unknown = recordFile(
        repositories,
        series,
        "/media-b/tv/Example/Unknown.mkv",
      );
      const groups = listLibraryGroups(repositories);
      expect(groups.map((group) => [group.key, group.files.length])).toEqual([
        [`season:${series.id}:0`, 1],
        [`season:${series.id}:1`, 3],
      ]);
      expect(groupForMedia(episode.id, repositories)).toEqual(
        groupForMedia(season.id, repositories),
      );
      expect(groupForMedia(episode.id, repositories)?.mediaIds).toContain(
        series.id,
      );
      expect(groupForLibraryFile(unknown, repositories)).toBeNull();
    } finally {
      fixture.close();
    }
  });

  test("keeps movie folders and existing seasons on their current volume", async () => {
    const fixture = await createFixture();
    try {
      const movie = media(fixture.repositories, {
        kind: "movie",
        title: "Film",
      });
      recordFile(fixture.repositories, movie, "/media-a/movies/Film/Film.mkv");
      const first = await fixture
        .service()
        .startFromCandidate(await fixture.candidate(movie));
      expect(first.downloadDirectory).toStartWith(VOLUME_A.downloadsPath);

      const { season, episode } = seasonTree(fixture.repositories, 1);
      recordFile(
        fixture.repositories,
        season,
        "/media-a/tv/Example/Season 01/Example.S01E01.mkv",
      );
      const second = await fixture
        .service()
        .startFromCandidate(await fixture.candidate(episode));
      expect(second.downloadDirectory).toStartWith(VOLUME_A.downloadsPath);
    } finally {
      fixture.close();
    }
  });

  test("different seasons may use different volumes while later episodes retain affinity", async () => {
    const fixture = await createFixture();
    try {
      const { series, episode } = seasonTree(fixture.repositories, 1);
      const first = await fixture
        .service()
        .startFromCandidate(await fixture.candidate(episode));
      expect(first.downloadDirectory).toStartWith(VOLUME_B.downloadsPath);
      fixture.free.set(VOLUME_A.downloadsPath, 500n * GIB);
      fixture.free.set(VOLUME_B.downloadsPath, 50n * GIB);
      const nextSeason = media(fixture.repositories, {
        kind: "season",
        title: "Season 2",
        parentId: series.id,
        seasonNumber: 2,
      });
      const nextEpisode = media(fixture.repositories, {
        kind: "episode",
        title: "Episode",
        parentId: nextSeason.id,
        seasonNumber: 2,
        episodeNumber: 1,
      });
      const second = await fixture
        .service()
        .startFromCandidate(await fixture.candidate(nextEpisode));
      expect(second.downloadDirectory).toStartWith(VOLUME_A.downloadsPath);
      const third = await fixture
        .service()
        .startFromCandidate(await fixture.candidate(episode));
      expect(third.downloadDirectory).toStartWith(VOLUME_B.downloadsPath);
    } finally {
      fixture.close();
    }
  });

  test("an unrelated season can start while a legacy series-owned season is reserved", async () => {
    const fixture = await createFixture();
    try {
      const { series, season } = seasonTree(fixture.repositories, 1);
      recordFile(
        fixture.repositories,
        series,
        "/media-a/tv/Example/Season 01/Example.S01E01.mkv",
      );
      const nextSeason = media(fixture.repositories, {
        kind: "season",
        title: "Season 2",
        parentId: series.id,
        seasonNumber: 2,
      });
      const candidate = await fixture.candidate(nextSeason);
      const movingGroup = groupForMedia(season.id, fixture.repositories)!;
      expect(movingGroup.mediaIds).toContain(series.id);
      const download = await withMediaMutation(
        fixture.database,
        movingGroup.mediaIds,
        () => fixture.service().startFromCandidate(candidate),
      );
      expect(download.state).toBe("queued");
    } finally {
      fixture.close();
    }
  });

  test("serializes simultaneous episode placement until the first assignment is persisted", async () => {
    const fixture = await createFixture();
    const inserted = Promise.withResolvers<void>();
    const releaseInsert = Promise.withResolvers<void>();
    try {
      const { season, episode } = seasonTree(fixture.repositories, 1);
      const secondEpisode = media(fixture.repositories, {
        kind: "episode",
        title: "Episode 2",
        parentId: season.id,
        seasonNumber: 1,
        episodeNumber: 2,
      });
      const candidate1 = await fixture.candidate(episode);
      const candidate2 = await fixture.candidate(secondEpisode);
      const adapter = downloadRepositoryFromDatabase(fixture.database);
      let inserts = 0;
      const delayed: DownloadRepository = {
        ...adapter,
        findById: (id) => adapter.findById(id),
        listForReconciliation: () => adapter.listForReconciliation(),
        transition: (id, states, patch) =>
          adapter.transition(id, states, patch),
        async insert(record) {
          if (inserts++ === 0) {
            inserted.resolve();
            await releaseInsert.promise;
          }
          await adapter.insert(record);
        },
      };
      const first = fixture.service(delayed).startFromCandidate(candidate1);
      await inserted.promise;
      fixture.free.set(VOLUME_A.downloadsPath, 500n * GIB);
      fixture.free.set(VOLUME_B.downloadsPath, 50n * GIB);
      const second = fixture.service(delayed).startFromCandidate(candidate2);
      releaseInsert.resolve();
      const downloads = await Promise.all([first, second]);
      expect(
        downloads.every((download) =>
          download.downloadDirectory.startsWith(VOLUME_B.downloadsPath),
        ),
      ).toBe(true);
    } finally {
      releaseInsert.resolve();
      fixture.close();
    }
  });

  test("refuses a full affinity volume without creating a split download", async () => {
    const fixture = await createFixture();
    try {
      const { episode } = seasonTree(fixture.repositories, 1);
      recordFile(
        fixture.repositories,
        episode,
        "/media-a/tv/Example/Season 01/Example.S01E01.mkv",
      );
      fixture.free.set(VOLUME_A.downloadsPath, STORAGE_RESERVE_BYTES + 1n);
      await expect(
        fixture.service().startFromCandidate(await fixture.candidate(episode)),
      ).rejects.toThrow("insufficient free space");
      expect(
        fixture.repositories.downloads.list({ limit: 100, offset: 0 }).total,
      ).toBe(0);
      expect(await fixture.queue.count()).toBe(0);
    } finally {
      fixture.close();
    }
  });

  test("reserves the expected sizes of queued downloads before placing another episode", async () => {
    const fixture = await createFixture();
    try {
      const { episode } = seasonTree(fixture.repositories, 1);
      const bytes = Number(120n * GIB);
      const first = await fixture
        .service()
        .startFromCandidate(await fixture.candidate(episode, bytes));
      expect(fixture.repositories.downloads.get(first.id)?.totalBytes).toBe(
        bytes,
      );
      await expect(
        fixture
          .service()
          .startFromCandidate(await fixture.candidate(episode, bytes)),
      ).rejects.toThrow("insufficient free space");
      expect(
        fixture.repositories.downloads.list({ limit: 100, offset: 0 }).total,
      ).toBe(1);
    } finally {
      fixture.close();
    }
  });

  test.each(["failed", "removed"] as const)(
    "ignores a %s download's stale affinity when the season has no library files",
    async (state) => {
      const fixture = await createFixture();
      try {
        const { episode } = seasonTree(fixture.repositories, 1);
        const first = await fixture
          .service()
          .startFromCandidate(await fixture.candidate(episode));
        await downloadRepositoryFromDatabase(fixture.database).transition(
          first.id,
          ["queued"],
          { state, updatedAt: Date.now() },
        );
        fixture.free.set(VOLUME_A.downloadsPath, 500n * GIB);
        const second = await fixture
          .service()
          .startFromCandidate(await fixture.candidate(episode));
        expect(second.downloadDirectory).toStartWith(VOLUME_A.downloadsPath);
      } finally {
        fixture.close();
      }
    },
  );

  test("follows the new library volume after organization instead of an older torrent directory", async () => {
    const fixture = await createFixture();
    try {
      const { episode } = seasonTree(fixture.repositories, 1);
      const file = recordFile(
        fixture.repositories,
        episode,
        "/media-a/tv/Example/Season 01/Example.S01E01.mkv",
      );
      const first = await fixture
        .service()
        .startFromCandidate(await fixture.candidate(episode));
      expect(first.downloadDirectory).toStartWith(VOLUME_A.downloadsPath);
      fixture.database.sqlite
        .query("UPDATE library_files SET path = ? WHERE id = ?")
        .run("/media-b/tv/Example/Season 01/Example.S01E01.mkv", file.id);
      const second = await fixture
        .service()
        .startFromCandidate(await fixture.candidate(episode));
      expect(second.downloadDirectory).toStartWith(VOLUME_B.downloadsPath);
    } finally {
      fixture.close();
    }
  });

  test("a previously split season must be consolidated before more files are placed", async () => {
    const fixture = await createFixture();
    try {
      const { season, episode } = seasonTree(fixture.repositories, 1);
      recordFile(
        fixture.repositories,
        season,
        "/media-a/tv/Example/Season 01/Example.S01E01.mkv",
      );
      recordFile(
        fixture.repositories,
        episode,
        "/media-b/tv/Example/Season 01/Example.S01E02.mkv",
      );
      await expect(
        fixture.service().startFromCandidate(await fixture.candidate(episode)),
      ).rejects.toThrow("split across volumes");
    } finally {
      fixture.close();
    }
  });

  test("an existing download can import into its season's current volume", async () => {
    const root = await mkdtemp(join(tmpdir(), "bobarr-volume-affinity-"));
    try {
      const volumeA = {
        ...VOLUME_A,
        downloadsPath: join(root, "a/downloads"),
        televisionPath: join(root, "a/tv"),
        moviesPath: join(root, "a/movies"),
      };
      const volumeB = {
        ...VOLUME_B,
        downloadsPath: join(root, "b/downloads"),
        televisionPath: join(root, "b/tv"),
        moviesPath: join(root, "b/movies"),
      };
      const downloadId = crypto.randomUUID();
      const downloadDirectory = join(volumeA.downloadsPath, downloadId);
      await mkdir(downloadDirectory, { recursive: true });
      const name = "Example.S01E02.mkv";
      await Bun.write(join(downloadDirectory, name), "complete media");
      const organizer = createFilesystemLibraryOrganizer({
        storage: {
          volumes: [volumeA, volumeB],
          organizationStrategy: "hardlink",
        },
      });
      const [organized] = await organizer.organize({
        downloadId,
        downloadDirectory,
        target: { kind: "episode", title: "Example", season: 1, episode: 2 },
        torrentName: "Example",
        libraryVolumeId: volumeB.id,
        files: [
          {
            index: 0,
            name,
            length: 14,
            bytesCompleted: 14,
            wanted: true,
            priority: "normal",
          },
        ],
      });
      expect(organized?.destination).toStartWith(
        await realpath(volumeB.televisionPath),
      );
      expect(await Bun.file(organized?.destination ?? "").text()).toBe(
        "complete media",
      );
      expect(await Bun.file(join(downloadDirectory, name)).text()).toBe(
        "complete media",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function createFixture() {
  const database = await openBackendDatabase(":memory:");
  const repositories = createRepositories(database);
  repositories.settings.update({
    storage: {
      volumes: [VOLUME_A, VOLUME_B],
      organizationStrategy: "hardlink",
    },
  });
  const queue = createSqliteJobQueue({ database: database.sqlite });
  const cipher = createAesCandidateCipher({ key: new Uint8Array(32).fill(9) });
  const free = new Map([
    [VOLUME_A.downloadsPath, 100n * GIB],
    [VOLUME_B.downloadsPath, 200n * GIB],
  ]);
  const placement = createDownloadPlacement({
    database,
    repositories,
    measure: async (path) => free.get(path) ?? null,
  });
  const unavailable = async (): Promise<never> => {
    throw new Error("Unexpected integration call");
  };
  const engine: TorrentEngine = {
    add: unavailable,
    get: unavailable,
    list: unavailable,
    selectFiles: unavailable,
    start: unavailable,
    pause: unavailable,
    remove: unavailable,
  };
  return {
    database,
    repositories,
    queue,
    free,
    service(downloadRepository = downloadRepositoryFromDatabase(database)) {
      return createAcquisitionService(
        {
          indexer: { search: unavailable, fetchMetainfo: unavailable },
          torrentEngine: engine,
          candidateRepository: candidateRepositoryFromDatabase(
            repositories.releases,
          ),
          candidateCipher: cipher,
          downloadRepository,
          jobQueue: queue,
        },
        placement,
      );
    },
    async candidate(item: LibraryItem, sizeBytes = 1024): Promise<string> {
      const target =
        item.kind === "movie"
          ? ({ kind: "movie", title: item.title } as const)
          : ({
              kind: item.kind === "episode" ? "episode" : "season",
              title: "Example",
              season: item.seasonNumber ?? 1,
              episode: item.episodeNumber ?? 1,
            } as const);
      const protectedSourcePayload = await cipher.seal({
        source: {
          kind: "magnet",
          magnetUri:
            "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
        },
        target,
        infoHash: "0123456789abcdef0123456789abcdef01234567",
      });
      return repositories.releases.create({
        mediaId: item.id,
        tmdbId: null,
        mediaKind: item.kind,
        title: item.title,
        indexer: "fixture",
        sizeBytes,
        seeders: 10,
        leechers: 0,
        publishedAt: null,
        quality: null,
        score: 1,
        eligible: true,
        reasons: [],
        protectedSourcePayload,
      }).id;
    },
    close() {
      queue.close();
      database.close();
    },
  };
}

function media(
  repositories: Repositories,
  input: Record<string, unknown>,
): LibraryItem {
  return repositories.media.create(CreateLibraryItemRequestSchema.parse(input));
}

function seasonTree(repositories: Repositories, seasonNumber: number) {
  const series = media(repositories, { kind: "series", title: "Example" });
  const season = media(repositories, {
    kind: "season",
    title: `Season ${seasonNumber}`,
    parentId: series.id,
    seasonNumber,
  });
  const episode = media(repositories, {
    kind: "episode",
    title: "Episode",
    parentId: season.id,
    seasonNumber,
    episodeNumber: 1,
  });
  return { series, season, episode };
}

function recordFile(
  repositories: Repositories,
  item: LibraryItem,
  path: string,
) {
  return repositories.libraryFiles.upsert({
    mediaId: item.id,
    downloadId: null,
    path,
    sizeBytes: 1024,
    quality: null,
    videoCodec: null,
    audioCodec: null,
    strategy: "copy",
  });
}
