import type { LibraryItem, StorageVolume } from "../../contracts";
import type {
  TorrentEngine,
  TorrentSnapshot,
} from "../integrations/transmission";

import { describe, expect, test } from "bun:test";
import { link, mkdir, mkdtemp, realpath, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { inventoryLibrary } from "./volume-inventory";
import {
  CreateDownloadInputSchema,
  CreateLibraryItemRequestSchema,
} from "../../contracts";
import { createRepositories, openBackendDatabase } from "../db";

describe("volume inventory ownership and dependencies", () => {
  test("an unavailable live torrent cannot become an unmanaged payload", async () => {
    const fixture = await setup();
    try {
      const season = fixture.season(1);
      const download = await fixture.torrent(season, {
        "Show.S01E01.mkv": "episode",
      });
      const file = await fixture.record(season, download, "Show.S01E01.mkv");
      fixture.torrents.delete(download.hash);

      expect(await fixture.inventory()).toEqual([]);
      expect(fixture.skipped.get(`season:${fixture.show.id}:1`)).toContain(
        "unavailable in Transmission",
      );
      expect(await Bun.file(file.path).text()).toBe("episode");
      expect(
        await Bun.file(join(download.source, "Show.S01E01.mkv")).text(),
      ).toBe("episode");
      expect(fixture.calls).toEqual([download.hash]);
    } finally {
      await fixture.close();
    }
  });

  test.each(["label", "hash", "progress", "selection"] as const)(
    "rejects a completed record with an invalid torrent %s",
    async (kind) => {
      const fixture = await setup();
      try {
        const season = fixture.season(1);
        const download = await fixture.torrent(season, {
          "Show.S01E01.mkv": "episode",
        });
        await fixture.record(season, download, "Show.S01E01.mkv");
        const snapshot = fixture.torrents.get(download.hash);
        if (!snapshot) throw new Error("Missing test torrent");
        if (kind === "label") snapshot.labels = [];
        if (kind === "hash") snapshot.hash = "f".repeat(40);
        if (kind === "progress") snapshot.progress = 0.5;
        if (kind === "selection")
          snapshot.files = snapshot.files.map((file) => ({
            ...file,
            bytesCompleted: 0,
          }));

        expect(await fixture.inventory()).toEqual([]);
        expect(fixture.skipped.size).toBe(1);
      } finally {
        await fixture.close();
      }
    },
  );

  test("a removed torrent's retained payload can move without an engine location change", async () => {
    const fixture = await setup();
    try {
      const season = fixture.season(1);
      const download = await fixture.torrent(season, {
        "Show.S01E01.mkv": "episode",
      });
      await fixture.record(season, download, "Show.S01E01.mkv");
      fixture.database.sqlite
        .query(
          "UPDATE downloads SET acquisition_state = 'removed' WHERE id = ?",
        )
        .run(download.id);
      fixture.torrents.delete(download.hash);

      const [unit] = await fixture.inventory();
      expect(unit?.downloads).toMatchObject([
        { id: download.id, hash: null, label: null, files: [] },
      ]);
      expect(fixture.skipped.size).toBe(0);
      expect(fixture.calls).toEqual([]);
    } finally {
      await fixture.close();
    }
  });

  test("a torrent spanning seasons produces one unit containing every season file and sidecar", async () => {
    const fixture = await setup();
    try {
      const first = fixture.season(1);
      const second = fixture.season(2);
      const independent = fixture.season(3);
      const download = await fixture.torrent(first, {
        "Show.S01E01.mkv": "first",
        "Show.S02E01.mkv": "second",
        "notes.txt": "notes",
      });
      const firstFile = await fixture.record(
        first,
        download,
        "Show.S01E01.mkv",
      );
      const secondFile = await fixture.record(
        second,
        download,
        "Show.S02E01.mkv",
      );
      const extra = await fixture.record(
        first,
        null,
        "Show.S01E02.mkv",
        "extra",
      );
      const poster = join(dirname(firstFile.path), "poster.jpg");
      await fixture.write(poster, "poster");
      await fixture.record(independent, null, "Show.S03E01.mkv", "independent");
      const snapshot = fixture.torrents.get(download.hash);
      if (!snapshot) throw new Error("Missing test torrent");
      snapshot.files = [...snapshot.files]
        .reverse()
        .map((file) => ({ ...file, wanted: file.name !== "notes.txt" }));

      const units = await fixture.inventory();
      const key = [
        `season:${fixture.show.id}:1`,
        `season:${fixture.show.id}:2`,
      ].join("|");
      const combined = units.find((unit) => unit.key === key);
      if (!combined) throw new Error("Missing combined season inventory");
      expect(units).toHaveLength(2);
      expect(combined?.groups.map((group) => group.key)).toEqual(
        key.split("|"),
      );
      expect(new Set(combined?.libraryFiles.map((file) => file.id))).toEqual(
        new Set([firstFile.id, secondFile.id, extra.id]),
      );
      expect(combined?.files.map((file) => file.path)).toContain(poster);
      expect(combined?.downloads).toHaveLength(1);
      expect(combined?.downloads[0]?.files).toEqual([
        { index: 0, name: "Show.S01E01.mkv", length: 5, wanted: true },
        { index: 1, name: "Show.S02E01.mkv", length: 6, wanted: true },
        { index: 2, name: "notes.txt", length: 5, wanted: false },
      ]);
      expect(combined?.bytesByVolume.get(fixture.a.id)).toBe(27n);
      expect(combined?.mediaIds).toContain(first.id);
      expect(combined?.mediaIds).toContain(second.id);
      expect(combined?.mediaIds).not.toContain(fixture.show.id);
      expect(new Set(combined?.files.map((file) => file.path)).size).toBe(
        combined?.files.length,
      );
      expect(fixture.calls).toEqual([download.hash]);
      expect(fixture.skipped.size).toBe(0);
    } finally {
      await fixture.close();
    }
  });

  test("shared payload inodes join separate torrents and all transitively dependent seasons", async () => {
    const fixture = await setup();
    try {
      const first = fixture.season(1);
      const second = fixture.season(2);
      const third = fixture.season(3);
      const downloadA = await fixture.torrent(first, {
        "Show.S01E01.mkv": "one",
        "Show.S02E01.mkv": "two",
        "shared.txt": "shared",
      });
      const downloadB = await fixture.torrent(third, {
        "Show.S03E01.mkv": "three",
        "shared.txt": "shared",
      });
      await fixture.record(first, downloadA, "Show.S01E01.mkv");
      await fixture.record(second, downloadA, "Show.S02E01.mkv");
      await fixture.record(third, downloadB, "Show.S03E01.mkv");
      await unlink(join(downloadB.source, "shared.txt"));
      await link(
        join(downloadA.source, "shared.txt"),
        join(downloadB.source, "shared.txt"),
      );

      const [unit, another] = await fixture.inventory();
      expect(another).toBeUndefined();
      expect(unit?.groups.map((group) => group.key)).toEqual(
        [1, 2, 3].map((season) => `season:${fixture.show.id}:${season}`),
      );
      expect(new Set(unit?.downloads.map((download) => download.id))).toEqual(
        new Set([downloadA.id, downloadB.id]),
      );
      expect(unit?.bytesByVolume.get(fixture.a.id)).toBe(17n);
      expect(fixture.skipped.size).toBe(0);
    } finally {
      await fixture.close();
    }
  });

  test("one unavailable torrent prevents transferring other seasons that depend on its payload", async () => {
    const fixture = await setup();
    try {
      const first = fixture.season(1);
      const second = fixture.season(2);
      const downloadA = await fixture.torrent(first, {
        "Show.S01E01.mkv": "one",
        "shared.txt": "shared",
      });
      const downloadB = await fixture.torrent(second, {
        "Show.S02E01.mkv": "two",
        "shared.txt": "shared",
      });
      await fixture.record(first, downloadA, "Show.S01E01.mkv");
      await fixture.record(second, downloadB, "Show.S02E01.mkv");
      await unlink(join(downloadB.source, "shared.txt"));
      await link(
        join(downloadA.source, "shared.txt"),
        join(downloadB.source, "shared.txt"),
      );
      fixture.torrents.delete(downloadB.hash);

      expect(await fixture.inventory()).toEqual([]);
      const key = [
        `season:${fixture.show.id}:1`,
        `season:${fixture.show.id}:2`,
      ].join("|");
      expect(fixture.skipped.get(key)).toContain("unavailable in Transmission");
      expect(
        await Bun.file(join(downloadA.source, "Show.S01E01.mkv")).text(),
      ).toBe("one");
    } finally {
      await fixture.close();
    }
  });

  test("unknown media sharing a torrent blocks the dependency unit with an ownership reason", async () => {
    const fixture = await setup();
    try {
      const season = fixture.season(1);
      const download = await fixture.torrent(season, {
        "Show.S01E01.mkv": "one",
        "Unidentified.mkv": "unknown",
      });
      await fixture.record(season, download, "Show.S01E01.mkv");
      const path = join(
        fixture.a.televisionPath,
        "Unknown",
        "Unidentified.mkv",
      );
      await mkdir(dirname(path), { recursive: true });
      await link(join(download.source, "Unidentified.mkv"), path);
      fixture.repositories.libraryFiles.upsert({
        mediaId: fixture.show.id,
        downloadId: null,
        path,
        sizeBytes: 7,
        strategy: "hardlink",
        quality: null,
        audioCodec: null,
        videoCodec: null,
      });

      expect(await fixture.inventory()).toEqual([]);
      expect(fixture.skipped.get(`season:${fixture.show.id}:1`)).toContain(
        "ownership could not be identified",
      );
      expect(await Bun.file(path).text()).toBe("unknown");
    } finally {
      await fixture.close();
    }
  });
});

async function setup() {
  const temporary = await mkdtemp(join(tmpdir(), "bobarr-volume-inventory-"));
  const root = await realpath(temporary);
  const database = await openBackendDatabase(":memory:");
  const repositories = createRepositories(database);
  const volumes: StorageVolume[] = ["a", "b"].map((id) => ({
    id,
    label: id.toUpperCase(),
    downloadsPath: join(root, id, "downloads"),
    moviesPath: join(root, id, "movies"),
    televisionPath: join(root, id, "tv"),
  }));
  for (const volume of volumes)
    for (const path of [
      volume.downloadsPath,
      volume.moviesPath,
      volume.televisionPath,
    ])
      await mkdir(path, { recursive: true });
  const a = volumes[0];
  if (!a) throw new Error("Missing test volume");
  const show = repositories.media.create(
    CreateLibraryItemRequestSchema.parse({
      kind: "series",
      title: "Show",
      status: "available",
    }),
  );
  const torrents = new Map<string, TorrentSnapshot>();
  const calls: string[] = [];
  const skipped = new Map<string, string>();
  const unavailable = async (): Promise<never> => {
    throw new Error("Unexpected torrent mutation");
  };
  const engine: TorrentEngine = {
    health: unavailable,
    add: unavailable,
    get: async (hash) => {
      calls.push(hash);
      return torrents.get(hash) ?? null;
    },
    list: async () => [...torrents.values()],
    selectFiles: unavailable,
    start: unavailable,
    pause: unavailable,
    setLocation: unavailable,
    remove: unavailable,
  };
  const write = async (path: string, contents: string): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, contents);
  };
  return {
    database,
    repositories,
    a,
    show,
    torrents,
    calls,
    skipped,
    write,
    season(number: number): LibraryItem {
      return repositories.media.create(
        CreateLibraryItemRequestSchema.parse({
          kind: "season",
          title: `Season ${number}`,
          parentId: show.id,
          seasonNumber: number,
          status: "available",
        }),
      );
    },
    async torrent(media: LibraryItem, contents: Record<string, string>) {
      const hash = crypto.randomUUID().replaceAll("-", "") + "12345678";
      const download = repositories.downloads.create(
        CreateDownloadInputSchema.parse({
          mediaId: media.id,
          title: "Show",
          state: "completed",
          externalId: hash,
        }),
      );
      const source = join(a.downloadsPath, download.id);
      const files: TorrentSnapshot["files"] = Object.entries(contents).map(
        ([name, value], index) => ({
          index,
          name,
          length: value.length,
          bytesCompleted: value.length,
          wanted: true,
          priority: "normal",
        }),
      );
      for (const [name, value] of Object.entries(contents))
        await write(join(source, name), value);
      database.sqlite
        .query(
          "UPDATE downloads SET download_directory = ?, download_path = ?, engine_info_hash = ?, engine_label = ?, acquisition_state = 'organized' WHERE id = ?",
        )
        .run(source, source, hash, `bobarr:${download.id}`, download.id);
      const size = files.reduce((total, file) => total + file.length, 0);
      torrents.set(hash, {
        hash,
        name: "Show",
        status: "seeding",
        progress: 1,
        metadataProgress: 1,
        totalSize: size,
        sizeWhenDone: size,
        leftUntilDone: 0,
        downloadRate: 0,
        uploadRate: 0,
        etaSeconds: null,
        downloadDirectory: source,
        labels: [`bobarr:${download.id}`],
        finished: true,
        stalled: false,
        error: null,
        files,
      });
      return { id: download.id, source, hash };
    },
    async record(
      media: LibraryItem,
      download: { id: string; source: string } | null,
      name: string,
      contents = "media",
    ) {
      const path = join(
        a.televisionPath,
        "Show",
        `Season ${String(media.seasonNumber).padStart(2, "0")}`,
        name,
      );
      await mkdir(dirname(path), { recursive: true });
      if (download) await link(join(download.source, name), path);
      else await write(path, contents);
      return repositories.libraryFiles.upsert({
        mediaId: media.id,
        downloadId: download?.id ?? null,
        path,
        sizeBytes: Bun.file(path).size,
        strategy: download ? "hardlink" : "copy",
        quality: null,
        audioCodec: null,
        videoCodec: null,
      });
    },
    inventory() {
      return inventoryLibrary({
        database,
        repositories,
        volumes,
        transmission: async () => engine,
        signal: new AbortController().signal,
        heartbeat: async () => undefined,
        skipped: (key, reason) => {
          skipped.set(key, reason);
        },
      });
    },
    async close() {
      database.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
