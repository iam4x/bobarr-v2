import type { LibraryFile, LibraryItem, StorageVolume } from "../../contracts";
import type {
  TorrentEngine,
  TorrentSnapshot,
} from "../integrations/transmission";

import { afterEach, describe, expect, test } from "bun:test";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  realpath,
  rm,
  symlink,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { inventoryLibrary } from "./volume-inventory";
import {
  createVolumeOrganizer,
  type VolumeOrganizerOptions,
} from "./volume-organizer";
import { buildVolumeTransfer, resumeVolumeTransfer } from "./volume-transfer";
import {
  CreateDownloadInputSchema,
  CreateLibraryItemRequestSchema,
} from "../../contracts";
import { createRepositories, openBackendDatabase } from "../db";
import {
  activeVolumeTransfers,
  hasActiveVolumeTransfer,
  saveVolumeTransfer,
  withMediaMutation,
} from "../db/volume-transfers";
import { STORAGE_RESERVE_BYTES } from "../storage";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("volume organization", () => {
  test("balances whole movies and seasons including sidecars", async () => {
    const fixture = await setup();
    const movie = fixture.movie("Movie");
    await fixture.record(movie, fixture.a, "Movie/video.mkv", "m".repeat(60));
    await fixture.write(
      join(fixture.a.moviesPath, "Movie/subtitle.srt"),
      "s".repeat(4),
    );
    const series = fixture.series("Series");
    const season = fixture.season(series, 1);
    const first = fixture.episode(season, 1);
    const second = fixture.episode(season, 2);
    await fixture.record(
      first,
      fixture.a,
      "Series/Season 01/Series S01E01.mkv",
      "a".repeat(30),
    );
    await fixture.record(
      second,
      fixture.a,
      "Series/Season 01/Series S01E02.mkv",
      "b".repeat(30),
    );
    await fixture.write(
      join(fixture.a.televisionPath, "Series/Season 01/poster.jpg"),
      "p".repeat(4),
    );

    await fixture.organize();

    const movieFiles = fixture.repositories.libraryFiles.listForMedia(movie.id);
    const episodes = [first, second].flatMap((item) =>
      fixture.repositories.libraryFiles.listForMedia(item.id),
    );
    const movieVolume = movieFiles[0]!.path.startsWith(fixture.a.moviesPath)
      ? fixture.a
      : fixture.b;
    const tvVolume = episodes[0]!.path.startsWith(fixture.a.televisionPath)
      ? fixture.a
      : fixture.b;
    expect(movieVolume.id).not.toBe(tvVolume.id);
    expect(
      episodes.every((file) => file.path.startsWith(tvVolume.televisionPath)),
    ).toBe(true);
    expect(
      await Bun.file(join(movieVolume.moviesPath, "Movie/subtitle.srt")).text(),
    ).toBe("ssss");
    expect(
      await Bun.file(
        join(tvVolume.televisionPath, "Series/Season 01/poster.jpg"),
      ).text(),
    ).toBe("pppp");
    expect(hasActiveVolumeTransfer(fixture.database)).toBe(false);
    const paths = fixture.repositories.libraryFiles.listPaths();
    await fixture.organize();
    expect(fixture.repositories.libraryFiles.listPaths()).toEqual(paths);
  });

  test.each(["hardlink", "symlink"] as const)(
    "moves seeded %s data and preserves the destination relationship",
    async (strategy) => {
      const fixture = await setup();
      const seeded = await fixture.seeded(strategy);
      await fixture.addLargeMovie();

      await fixture.organize();

      const moved = fixture.repositories.libraryFiles.get(seeded.file.id)!;
      const payload = join(
        fixture.b.downloadsPath,
        seeded.downloadId,
        "release/video.mkv",
      );
      expect(moved.id).toBe(seeded.file.id);
      expect(moved.path).toBe(join(fixture.b.moviesPath, "Seeded/video.mkv"));
      expect(await Bun.file(payload).text()).toBe("seeded-content");
      expect(
        await Bun.file(
          join(
            fixture.b.downloadsPath,
            seeded.downloadId,
            "release/readme.txt",
          ),
        ).text(),
      ).toBe("extra");
      expect(await Bun.file(seeded.source).exists()).toBe(false);
      expect(await Bun.file(seeded.file.path).exists()).toBe(false);
      expect(fixture.torrents.get(seeded.hash)?.downloadDirectory).toBe(
        join(fixture.b.downloadsPath, seeded.downloadId),
      );
      expect(fixture.torrents.get(seeded.hash)?.status).toBe("seeding");
      expect(
        fixture.repositories.downloads.get(seeded.downloadId)?.downloadPath,
      ).toBe(join(fixture.b.downloadsPath, seeded.downloadId));
      if (strategy === "hardlink")
        expect((await lstat(moved.path)).ino).toBe((await lstat(payload)).ino);
      else
        expect(resolve(dirname(moved.path), await readlink(moved.path))).toBe(
          payload,
        );
      expect(fixture.calls).toContain(`location:${seeded.hash}`);
      expect(hasActiveVolumeTransfer(fixture.database)).toBe(false);
    },
  );

  test("resumes after a committed transfer and after interrupted source cleanup", async () => {
    const fixture = await setup();
    const seeded = await fixture.seeded("hardlink");
    await fixture.addLargeMovie();
    let interruption = "commit";
    const heartbeat = async () => {
      const transfer = activeVolumeTransfers(fixture.database)[0];
      if (transfer?.stage !== "committed") return;
      if (interruption === "commit") throw new Error("stop after commit");
      if (
        interruption === "cleanup" &&
        !(await Bun.file(seeded.source).exists())
      )
        throw new Error("stop during cleanup");
    };
    await expect(fixture.organize(heartbeat)).rejects.toThrow(
      "stop after commit",
    );
    expect(await Bun.file(seeded.source).exists()).toBe(true);
    expect(
      fixture.repositories.libraryFiles.get(seeded.file.id)?.path,
    ).toStartWith(fixture.b.moviesPath);
    interruption = "cleanup";
    await expect(fixture.organize(heartbeat)).rejects.toThrow(
      "stop during cleanup",
    );
    expect(await Bun.file(seeded.source).exists()).toBe(false);
    interruption = "none";
    await fixture.organize(heartbeat);
    expect(hasActiveVolumeTransfer(fixture.database)).toBe(false);
    expect(fixture.repositories.libraryFiles.get(seeded.file.id)?.id).toBe(
      seeded.file.id,
    );
    expect(
      await Bun.file(join(fixture.b.moviesPath, "Seeded/video.mkv")).text(),
    ).toBe("seeded-content");
  });

  test("keeps source data and records untouched when the destination collides", async () => {
    const fixture = await setup();
    const seeded = await fixture.seeded("hardlink");
    await fixture.addLargeMovie();
    const collision = join(fixture.b.moviesPath, "Seeded/video.mkv");
    await fixture.write(collision, "unrelated file");

    await expect(fixture.organize()).rejects.toThrow("collision");

    expect(fixture.repositories.libraryFiles.get(seeded.file.id)?.path).toBe(
      seeded.file.path,
    );
    expect(await Bun.file(seeded.source).text()).toBe("seeded-content");
    expect(await Bun.file(collision).text()).toBe("unrelated file");
    await unlink(collision);
    await fixture.organize();
    expect(fixture.repositories.libraryFiles.get(seeded.file.id)?.path).toBe(
      collision,
    );
    expect(hasActiveVolumeTransfer(fixture.database)).toBe(false);
  });

  test("recovers when Transmission applies the location before its response fails", async () => {
    const fixture = await setup();
    const seeded = await fixture.seeded("hardlink");
    await fixture.addLargeMovie();
    const setLocation = fixture.engine.setLocation;
    let fail = true;
    fixture.engine.setLocation = async (...args) => {
      await setLocation(...args);
      if (fail) throw new Error("response lost");
    };
    await expect(fixture.organize()).rejects.toThrow("response lost");
    expect(fixture.repositories.libraryFiles.get(seeded.file.id)?.path).toBe(
      seeded.file.path,
    );
    expect(await Bun.file(seeded.source).exists()).toBe(true);
    fail = false;
    await fixture.organize();
    expect(
      fixture.repositories.libraryFiles.get(seeded.file.id)?.path,
    ).toStartWith(fixture.b.moviesPath);
    expect(await Bun.file(seeded.source).exists()).toBe(false);
  });

  test.each(["hardlink", "symlink"] as const)(
    "relinks a %s already on the destination volume",
    async (strategy) => {
      const fixture = await setup();
      const seeded = await fixture.seeded(strategy);
      await fixture.addLargeMovie();
      const libraryPath = join(fixture.b.moviesPath, "Seeded/video.mkv");
      await mkdir(dirname(libraryPath), { recursive: true });
      if (strategy === "hardlink") await link(seeded.source, libraryPath);
      else
        await symlink(
          relative(dirname(libraryPath), seeded.source),
          libraryPath,
        );
      await unlink(seeded.file.path);
      fixture.database.sqlite
        .query("UPDATE library_files SET path = ? WHERE id = ?")
        .run(libraryPath, seeded.file.id);
      await fixture.organize();
      const payload = join(
        fixture.b.downloadsPath,
        seeded.downloadId,
        "release/video.mkv",
      );
      expect(await Bun.file(libraryPath).text()).toBe("seeded-content");
      if (strategy === "hardlink")
        expect((await lstat(libraryPath)).ino).toBe((await lstat(payload)).ino);
      else
        expect(resolve(dirname(libraryPath), await readlink(libraryPath))).toBe(
          payload,
        );
      expect(await Bun.file(seeded.source).exists()).toBe(false);
    },
  );

  test("resumes verified staged copies without losing source records", async () => {
    const fixture = await setup();
    const seeded = await fixture.seeded("hardlink");
    await fixture.addLargeMovie();
    let fail = true;
    await expect(
      fixture.organize(async () => {
        const transfer = activeVolumeTransfers(fixture.database)[0];
        if (
          fail &&
          transfer?.stage === "copying" &&
          transfer.files.some((file) => file.checksum !== null)
        )
          throw new Error("stop during copy phase");
      }),
    ).rejects.toThrow("stop during copy phase");
    expect(await Bun.file(seeded.source).exists()).toBe(true);
    expect(fixture.repositories.libraryFiles.get(seeded.file.id)?.path).toBe(
      seeded.file.path,
    );
    fail = false;
    await fixture.organize();
    expect(hasActiveVolumeTransfer(fixture.database)).toBe(false);
  });

  test("keeps paused torrent data until its destination ownership is verified", async () => {
    const fixture = await setup();
    const seeded = await fixture.seeded("hardlink", false);
    await fixture.addLargeMovie();
    let stopped = false;
    await expect(
      fixture.organize(async () => {
        if (
          !stopped &&
          activeVolumeTransfers(fixture.database)[0]?.stage === "committed"
        ) {
          stopped = true;
          throw new Error("stop after commit");
        }
      }),
    ).rejects.toThrow("stop after commit");
    const torrent = fixture.torrents.get(seeded.hash)!;
    torrent.labels = [];
    await expect(fixture.organize()).rejects.toThrow(
      "Torrent location changed",
    );
    expect(await Bun.file(seeded.source).exists()).toBe(true);
    torrent.labels = [`bobarr:${seeded.downloadId}`];
    await fixture.organize();
    expect(torrent.status).toBe("stopped");
    expect(fixture.calls).not.toContain(`start:${seeded.hash}`);
  });

  test("consolidates a split season while preserving all episode records", async () => {
    const fixture = await setup();
    const series = fixture.series("Split");
    const season = fixture.season(series, 1);
    const first = await fixture.record(
      fixture.episode(season, 1),
      fixture.a,
      "Split/Season 01/Split S01E01.mkv",
      "one",
    );
    const second = await fixture.record(
      fixture.episode(season, 2),
      fixture.b,
      "Split/Season 01/Split S01E02.mkv",
      "two",
    );
    await fixture.organize();
    const firstPath = fixture.repositories.libraryFiles.get(first.id)!.path;
    const secondPath = fixture.repositories.libraryFiles.get(second.id)!.path;
    expect(firstPath.startsWith(fixture.a.televisionPath)).toBe(
      secondPath.startsWith(fixture.a.televisionPath),
    );
    expect(await Bun.file(firstPath).text()).toBe("one");
    expect(await Bun.file(secondPath).text()).toBe("two");
  });

  test("leaves a group reserved by an import untouched", async () => {
    const fixture = await setup();
    const seeded = await fixture.seeded("hardlink");
    await fixture.addLargeMovie();
    await withMediaMutation(fixture.database, [seeded.movie.id], async () => {
      await fixture.organize();
    });
    expect(fixture.repositories.libraryFiles.get(seeded.file.id)?.path).toBe(
      seeded.file.path,
    );
    expect(await Bun.file(seeded.source).exists()).toBe(true);
  });

  test("organizes canonical records when storage roots use directory aliases", async () => {
    const fixture = await setup();
    const seeded = await fixture.seeded("hardlink");
    await fixture.addLargeMovie();
    const volumes: StorageVolume[] = [];
    for (const volume of [fixture.a, fixture.b]) {
      const alias = `${dirname(volume.downloadsPath)}-alias`;
      await symlink(dirname(volume.downloadsPath), alias, "dir");
      volumes.push({
        ...volume,
        downloadsPath: join(alias, "downloads"),
        moviesPath: join(alias, "movies"),
        televisionPath: join(alias, "tv"),
      });
    }
    fixture.repositories.settings.update({
      storage: {
        volumes: [volumes[0]!, volumes[1]!],
        organizationStrategy: "hardlink",
      },
    });
    await fixture.organize();
    expect(
      fixture.repositories.libraryFiles.get(seeded.file.id)?.path,
    ).toStartWith(fixture.b.moviesPath);
    expect(await Bun.file(seeded.source).exists()).toBe(false);
    expect(hasActiveVolumeTransfer(fixture.database)).toBe(false);
  });
  test("rejects external file selection changes before publication and source cleanup", async () => {
    const fixture = await setup();
    const seeded = await fixture.seeded("hardlink");
    await fixture.addLargeMovie();
    const torrent = fixture.torrents.get(seeded.hash)!;
    const originalFiles = torrent.files;
    let changed = false;
    await expect(
      fixture.organize(async () => {
        const transfer = activeVolumeTransfers(fixture.database)[0];
        if (
          !changed &&
          transfer?.stage === "copying" &&
          transfer.files.some((file) => file.checksum !== null)
        ) {
          changed = true;
          torrent.files = originalFiles.map((file) => ({
            ...file,
            wanted: false,
          }));
        }
      }),
    ).rejects.toThrow("selected files changed");
    expect(fixture.calls.some((call) => call.startsWith("location:"))).toBe(
      false,
    );
    expect(await Bun.file(seeded.source).exists()).toBe(true);
    expect(fixture.repositories.libraryFiles.get(seeded.file.id)?.path).toBe(
      seeded.file.path,
    );
    torrent.files = originalFiles;
    await expect(
      fixture.organize(async () => {
        if (activeVolumeTransfers(fixture.database)[0]?.stage === "committed")
          throw new Error("stop after commit");
      }),
    ).rejects.toThrow("stop after commit");
    torrent.files = originalFiles.map((file) => ({ ...file, wanted: false }));
    await expect(fixture.organize()).rejects.toThrow("selected files changed");
    expect(await Bun.file(seeded.source).exists()).toBe(true);
    torrent.files = originalFiles.map((file) => ({
      ...file,
      bytesCompleted: 0,
    }));
    await expect(fixture.organize()).rejects.toThrow("no longer complete");
    expect(await Bun.file(seeded.source).exists()).toBe(true);
    torrent.files = originalFiles;
    await fixture.organize();
    expect(await Bun.file(seeded.source).exists()).toBe(false);
  });

  test("copies on distinct destination filesystems and stages beside each root", async () => {
    const fixture = await setup();
    const seeded = await fixture.seeded("hardlink");
    await fixture.addLargeMovie();
    fixture.repositories.settings.update({
      storage: {
        volumes: [fixture.a, fixture.b],
        organizationStrategy: "copy",
      },
    });
    const measured = new Set<string>();
    const stagedRoots = new Set<string>();
    await fixture.organize(
      async () => {
        const transfer = activeVolumeTransfers(fixture.database)[0];
        for (const file of transfer?.files ?? []) {
          expect(
            file.stagingPath.startsWith(
              join(file.destinationRoot, ".bobarr-volume-organize"),
            ),
          ).toBe(true);
          stagedRoots.add(file.destinationRoot);
        }
      },
      {
        deviceForPath: async (path) => (path === fixture.b.moviesPath ? 2 : 1),
        measureFreeBytes: async (path) => {
          measured.add(path);
          return STORAGE_RESERVE_BYTES + 1024n * 1024n;
        },
      },
    );
    const moved = fixture.repositories.libraryFiles.get(seeded.file.id)!;
    const payload = join(
      fixture.b.downloadsPath,
      seeded.downloadId,
      "release/video.mkv",
    );
    expect(moved.path).toStartWith(fixture.b.moviesPath);
    expect(moved.strategy).toBe("copy");
    expect((await lstat(moved.path)).ino).not.toBe((await lstat(payload)).ino);
    expect(await Bun.file(moved.path).text()).toBe("seeded-content");
    expect(await Bun.file(payload).text()).toBe("seeded-content");
    expect(measured.has(fixture.b.moviesPath)).toBe(true);
    expect(stagedRoots).toContain(fixture.b.moviesPath);
    expect(stagedRoots).toContain(fixture.b.downloadsPath);
    expect(await Bun.file(seeded.source).exists()).toBe(false);
  });

  test("rejects a library filesystem without space despite free download storage", async () => {
    const fixture = await setup();
    const seeded = await fixture.seeded("hardlink");
    await fixture.addLargeMovie();
    fixture.repositories.settings.update({
      storage: {
        volumes: [fixture.a, fixture.b],
        organizationStrategy: "copy",
      },
    });
    await fixture.organize(undefined, {
      deviceForPath: async (path) => (path === fixture.b.moviesPath ? 2 : 1),
      measureFreeBytes: async (path) =>
        STORAGE_RESERVE_BYTES +
        (path === fixture.b.moviesPath ? 13n : 1024n * 1024n),
    });
    expect(fixture.repositories.libraryFiles.get(seeded.file.id)?.path).toBe(
      seeded.file.path,
    );
    expect(await Bun.file(seeded.source).text()).toBe("seeded-content");
    expect(fixture.calls.some((call) => call.startsWith("location:"))).toBe(
      false,
    );
    expect(hasActiveVolumeTransfer(fixture.database)).toBe(false);
  });

  test("canonical entry aliases never delete an already colocated destination", async () => {
    const fixture = await setup();
    const seeded = await fixture.seeded("symlink");
    const alias = `${dirname(fixture.a.downloadsPath)}-alias`;
    await symlink(dirname(fixture.a.downloadsPath), alias, "dir");
    const aliasedVolume: StorageVolume = {
      ...fixture.a,
      downloadsPath: join(alias, "downloads"),
      moviesPath: join(alias, "movies"),
      televisionPath: join(alias, "tv"),
    };
    const aliasedDownload = join(
      aliasedVolume.downloadsPath,
      seeded.downloadId,
    );
    fixture.repositories.settings.update({
      storage: {
        volumes: [aliasedVolume, fixture.b],
        organizationStrategy: "symlink",
      },
    });
    fixture.database.sqlite
      .query(
        "UPDATE downloads SET download_path = ?, download_directory = ? WHERE id = ?",
      )
      .run(aliasedDownload, aliasedDownload, seeded.downloadId);
    fixture.database.sqlite
      .query("UPDATE library_files SET path = ? WHERE id = ?")
      .run(join(aliasedVolume.moviesPath, "Seeded/video.mkv"), seeded.file.id);
    fixture.torrents.get(seeded.hash)!.downloadDirectory = aliasedDownload;
    const signal = new AbortController().signal;
    const heartbeat = async () => undefined;
    const groups = await inventoryLibrary({
      database: fixture.database,
      repositories: fixture.repositories,
      volumes: [aliasedVolume, fixture.b],
      transmission: async () => fixture.engine,
      signal,
      heartbeat,
      skipped: () => undefined,
    });
    const group = groups.find((item) =>
      item.libraryFiles.some((file) => file.id === seeded.file.id),
    )!;
    const transfer = await buildVolumeTransfer({
      group,
      volumes: [aliasedVolume, fixture.b],
      destination: fixture.a,
      jobId: crypto.randomUUID(),
      measureFreeBytes: async () => STORAGE_RESERVE_BYTES + 1024n,
    });
    expect(
      transfer.files.every((file) => file.source === file.destination),
    ).toBe(true);
    saveVolumeTransfer(fixture.database, transfer);
    await resumeVolumeTransfer({
      database: fixture.database,
      transfer,
      transmission: async () => fixture.engine,
      signal,
      heartbeat,
      measureFreeBytes: async () => STORAGE_RESERVE_BYTES + 1024n,
    });
    expect(await Bun.file(seeded.source).text()).toBe("seeded-content");
    expect(await Bun.file(seeded.file.path).text()).toBe("seeded-content");
    expect(fixture.calls.some((call) => call.startsWith("location:"))).toBe(
      false,
    );
  });

  test("defers a plan when its destination is removed from settings during inspection", async () => {
    const fixture = await setup();
    const seeded = await fixture.seeded("hardlink");
    await fixture.addLargeMovie();
    let changed = false;
    await expect(
      fixture.organize(undefined, {
        measureFreeBytes: async (path) => {
          if (!changed && path === fixture.b.moviesPath) {
            changed = true;
            fixture.repositories.settings.update({
              storage: {
                volumes: [fixture.a],
                organizationStrategy: "hardlink",
              },
            });
          }
          return STORAGE_RESERVE_BYTES + 1024n * 1024n;
        },
      }),
    ).rejects.toThrow("Storage settings changed");
    expect(changed).toBe(true);
    expect(hasActiveVolumeTransfer(fixture.database)).toBe(false);
    expect(fixture.repositories.libraryFiles.get(seeded.file.id)?.path).toBe(
      seeded.file.path,
    );
    expect(await Bun.file(seeded.source).text()).toBe("seeded-content");
    expect(fixture.calls.some((call) => call.startsWith("location:"))).toBe(
      false,
    );
  });

  test("moves seasons sharing a completed torrent as one dependency group", async () => {
    const fixture = await setup();
    const seeded = await fixture.seeded("hardlink");
    await fixture.addLargeMovie();
    const series = fixture.series("Shared");
    const firstSeason = fixture.season(series, 1);
    const secondSeason = fixture.season(series, 2);
    const first = await fixture.record(
      fixture.episode(firstSeason, 1),
      fixture.a,
      "Shared/Season 01/Shared S01E01.mkv",
      "seeded-content",
    );
    const second = await fixture.record(
      fixture.episode(secondSeason, 1),
      fixture.a,
      "Shared/Season 02/Shared S02E01.mkv",
      "other",
    );
    const secondSource = join(dirname(seeded.source), "other.mkv");
    await fixture.write(secondSource, "other");
    await unlink(first.path);
    await unlink(second.path);
    await link(seeded.source, first.path);
    await link(secondSource, second.path);
    await unlink(seeded.file.path);
    fixture.repositories.libraryFiles.delete(seeded.file.id);
    fixture.database.sqlite
      .query("UPDATE downloads SET media_item_id = ? WHERE id = ?")
      .run(firstSeason.id, seeded.downloadId);
    fixture.database.sqlite
      .query(
        "UPDATE library_files SET download_id = ?, strategy = 'hardlink' WHERE id IN (?, ?)",
      )
      .run(seeded.downloadId, first.id, second.id);
    const torrent = fixture.torrents.get(seeded.hash)!;
    torrent.files = [
      ...torrent.files,
      {
        index: 1,
        name: "release/other.mkv",
        length: 5,
        bytesCompleted: 5,
        wanted: true,
        priority: "normal",
      },
    ];
    let sawSharedTransfer = false;
    await fixture.organize(async () => {
      const transfer = activeVolumeTransfers(fixture.database).find((item) =>
        item.downloads.some((download) => download.id === seeded.downloadId),
      );
      if (!transfer) return;
      sawSharedTransfer = true;
      expect(transfer.groupKeys).toHaveLength(2);
      expect(transfer.groupKeys).toContain(`season:${series.id}:1`);
      expect(transfer.groupKeys).toContain(`season:${series.id}:2`);
    });
    expect(sawSharedTransfer).toBe(true);
    expect(fixture.repositories.libraryFiles.get(first.id)?.path).toStartWith(
      fixture.b.televisionPath,
    );
    expect(fixture.repositories.libraryFiles.get(second.id)?.path).toStartWith(
      fixture.b.televisionPath,
    );
    expect(await Bun.file(seeded.source).exists()).toBe(false);
    expect(await Bun.file(secondSource).exists()).toBe(false);
    expect(torrent.downloadDirectory).toBe(
      join(fixture.b.downloadsPath, seeded.downloadId),
    );
  });
});

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bobarr-volumes-")));
  const database = await openBackendDatabase(join(root, "bobarr.sqlite"));
  const repositories = createRepositories(database);
  const a: StorageVolume = {
    id: "a",
    label: "A",
    downloadsPath: join(root, "a/downloads"),
    moviesPath: join(root, "a/movies"),
    televisionPath: join(root, "a/tv"),
  };
  const b: StorageVolume = {
    id: "b",
    label: "B",
    downloadsPath: join(root, "b/downloads"),
    moviesPath: join(root, "b/movies"),
    televisionPath: join(root, "b/tv"),
  };
  for (const volume of [a, b])
    for (const path of [
      volume.downloadsPath,
      volume.moviesPath,
      volume.televisionPath,
    ])
      await mkdir(path, { recursive: true });
  repositories.settings.ensureDefaults();
  repositories.settings.update({
    storage: { volumes: [a, b], organizationStrategy: "hardlink" },
  });
  const torrents = new Map<string, TorrentSnapshot>();
  const calls: string[] = [];
  const engine: TorrentEngine = {
    health: async () => ({
      version: "4.1.3",
      rpcVersion: "6.0.1",
      minimumRpcVersion: "6.0.0",
    }),
    add: async () => {
      throw new Error("unexpected add");
    },
    get: async (hash) => torrents.get(hash) ?? null,
    list: async () => [...torrents.values()],
    selectFiles: async () => undefined,
    start: async (hash) => {
      calls.push(`start:${hash}`);
      const torrent = torrents.get(hash);
      if (torrent) torrent.status = "seeding";
    },
    pause: async (hash) => {
      calls.push(`pause:${hash}`);
      const torrent = torrents.get(hash);
      if (torrent) torrent.status = "stopped";
    },
    setLocation: async (hash, location) => {
      calls.push(`location:${hash}`);
      const torrent = torrents.get(hash);
      if (torrent) torrent.downloadDirectory = location;
    },
    remove: async () => undefined,
  };
  cleanups.push(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });
  function item(
    title: string,
    kind: LibraryItem["kind"],
    parentId: string | null = null,
    seasonNumber: number | null = null,
    episodeNumber: number | null = null,
  ): LibraryItem {
    return repositories.media.create(
      CreateLibraryItemRequestSchema.parse({
        title,
        kind,
        parentId,
        seasonNumber,
        episodeNumber,
        status: "available",
        monitorPolicy: "none",
      }),
    );
  }
  const movie = (title: string) => item(title, "movie");
  const series = (title: string) => item(title, "series");
  const season = (show: LibraryItem, number: number) =>
    item(`${show.title} Season ${number}`, "season", show.id, number);
  const episode = (seasonItem: LibraryItem, number: number) =>
    item(
      `Episode ${number}`,
      "episode",
      seasonItem.id,
      seasonItem.seasonNumber,
      number,
    );
  async function write(path: string, content: string) {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, content);
  }
  async function record(
    media: LibraryItem,
    volume: StorageVolume,
    path: string,
    content: string,
  ): Promise<LibraryFile> {
    const full = join(
      media.kind === "movie" ? volume.moviesPath : volume.televisionPath,
      path,
    );
    await write(full, content);
    return repositories.libraryFiles.upsert({
      mediaId: media.id,
      downloadId: null,
      path: full,
      sizeBytes: content.length,
      strategy: "copy",
      quality: null,
      audioCodec: null,
      videoCodec: null,
    });
  }
  async function seeded(strategy: "hardlink" | "symlink", running = true) {
    const media = movie("Seeded");
    const hash = crypto.randomUUID().replaceAll("-", "") + "12345678";
    const download = repositories.downloads.create(
      CreateDownloadInputSchema.parse({
        mediaId: media.id,
        title: "Seeded",
        state: "completed",
        externalId: hash,
      }),
    );
    const directory = join(a.downloadsPath, download.id);
    const source = join(directory, "release/video.mkv");
    await write(source, "seeded-content");
    await write(join(directory, "release/readme.txt"), "extra");
    database.sqlite
      .query(
        "UPDATE downloads SET download_directory = ?, download_path = ?, engine_info_hash = ?, engine_label = ?, acquisition_state = 'organized' WHERE id = ?",
      )
      .run(directory, directory, hash, `bobarr:${download.id}`, download.id);
    const libraryPath = join(a.moviesPath, "Seeded/video.mkv");
    await mkdir(dirname(libraryPath), { recursive: true });
    if (strategy === "hardlink") await link(source, libraryPath);
    else await symlink(relative(dirname(libraryPath), source), libraryPath);
    const file = repositories.libraryFiles.upsert({
      mediaId: media.id,
      downloadId: download.id,
      path: libraryPath,
      sizeBytes: "seeded-content".length,
      strategy,
      quality: null,
      audioCodec: null,
      videoCodec: null,
    });
    torrents.set(hash, {
      hash,
      name: "Seeded",
      status: running ? "seeding" : "stopped",
      progress: 1,
      metadataProgress: 1,
      totalSize: 14,
      sizeWhenDone: 14,
      leftUntilDone: 0,
      downloadRate: 0,
      uploadRate: 0,
      etaSeconds: null,
      downloadDirectory: directory,
      labels: [`bobarr:${download.id}`],
      finished: true,
      stalled: false,
      error: null,
      files: [
        {
          index: 0,
          name: "release/video.mkv",
          length: 14,
          bytesCompleted: 14,
          wanted: true,
          priority: "normal",
        },
      ],
    });
    return { movie: media, file, downloadId: download.id, source, hash };
  }
  async function organize(
    heartbeat: () => Promise<void> = async () => undefined,
    storageOptions: Pick<
      VolumeOrganizerOptions,
      "measureFreeBytes" | "deviceForPath"
    > = {},
  ) {
    const organizer = createVolumeOrganizer({
      database,
      repositories,
      integrations: { transmission: async () => engine },
      measureFreeBytes: async () => STORAGE_RESERVE_BYTES + 1024n * 1024n,
      ...storageOptions,
    });
    await organizer.organize({
      jobId: crypto.randomUUID(),
      signal: new AbortController().signal,
      heartbeat,
    });
  }
  return {
    database,
    repositories,
    a,
    b,
    torrents,
    engine,
    calls,
    movie,
    series,
    season,
    episode,
    write,
    record,
    seeded,
    organize,
    addLargeMovie: async () =>
      record(movie("Large"), a, "Large/video.mkv", "x".repeat(1000)),
  };
}
