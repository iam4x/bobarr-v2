import { describe, expect, test } from "bun:test";

import {
  STORAGE_RESERVE_BYTES,
  libraryRootFor,
  libraryRoots,
  placeDownload,
  storageLayoutEquals,
  uncoveredStoragePaths,
} from "./storage";
import { AppSettingsSchema } from "../contracts/settings";

const VOLUME_A = {
  id: "disk-a",
  label: "Disk A",
  downloadsPath: "/media/downloads",
  moviesPath: "/media/movies",
  televisionPath: "/media/tv",
} as const;

const VOLUME_B = {
  id: "disk-b",
  label: "Disk B",
  downloadsPath: "/media-b/downloads",
  moviesPath: "/media-b/movies",
  televisionPath: "/media-b/tv",
} as const;

const VOLUMES = [VOLUME_A, VOLUME_B] as const;
const DOWNLOAD_A = "11111111-1111-4111-8111-111111111111";
const DOWNLOAD_B = "22222222-2222-4222-8222-222222222222";

describe("placeDownload", () => {
  test("prefers the volume with more free bytes", () => {
    const placed = placeDownload({
      volumes: VOLUMES,
      freeBytesByVolumeId: new Map([
        [VOLUME_A.id, 20n * 1024n * 1024n * 1024n],
        [VOLUME_B.id, 80n * 1024n * 1024n * 1024n],
      ]),
      downloadId: DOWNLOAD_A,
    });
    expect(placed).toEqual({
      volumeId: VOLUME_B.id,
      downloadDirectory: `${VOLUME_B.downloadsPath}/${DOWNLOAD_A}`,
    });
  });

  test("a 90%-full disk loses to an empty one", () => {
    const placed = placeDownload({
      volumes: VOLUMES,
      freeBytesByVolumeId: new Map([
        [VOLUME_A.id, STORAGE_RESERVE_BYTES + 1n],
        [VOLUME_B.id, 200n * 1024n * 1024n * 1024n],
      ]),
      downloadId: DOWNLOAD_A,
    });
    expect(placed.volumeId).toBe(VOLUME_B.id);
  });

  test("equal free: two different download ids split across volumes", () => {
    const freeBytesByVolumeId = new Map([
      [VOLUME_A.id, 50n * 1024n * 1024n * 1024n],
      [VOLUME_B.id, 50n * 1024n * 1024n * 1024n],
    ]);
    const seen = new Set<string>();
    for (const downloadId of [DOWNLOAD_A, DOWNLOAD_B, "dl-3", "dl-4", "dl-5"]) {
      seen.add(
        placeDownload({
          volumes: VOLUMES,
          freeBytesByVolumeId,
          downloadId,
        }).volumeId,
      );
    }
    expect(seen).toEqual(new Set([VOLUME_A.id, VOLUME_B.id]));
  });

  test("missing map entry is skipped even if it would be emptiest", () => {
    const placed = placeDownload({
      volumes: VOLUMES,
      freeBytesByVolumeId: new Map([[VOLUME_A.id, 1n]]),
      downloadId: DOWNLOAD_A,
    });
    expect(placed.volumeId).toBe(VOLUME_A.id);
  });

  test("all under reserve still places on the most-free measured volume", () => {
    const placed = placeDownload({
      volumes: VOLUMES,
      freeBytesByVolumeId: new Map([
        [VOLUME_A.id, 1n],
        [VOLUME_B.id, STORAGE_RESERVE_BYTES],
      ]),
      downloadId: DOWNLOAD_A,
    });
    expect(placed.volumeId).toBe(VOLUME_B.id);
  });

  test("no measured volumes throws", () => {
    expect(() =>
      placeDownload({
        volumes: VOLUMES,
        freeBytesByVolumeId: new Map(),
        downloadId: DOWNLOAD_A,
      }),
    ).toThrow("No storage volume could be measured");
  });
});

describe("storage roots", () => {
  test("libraryRoots tags kind; two movie roots both kind movie", () => {
    const storage = {
      volumes: VOLUMES,
      organizationStrategy: "hardlink" as const,
    };
    expect(libraryRoots(storage, "movie")).toEqual([
      { path: VOLUME_A.moviesPath, kind: "movie" },
      { path: VOLUME_B.moviesPath, kind: "movie" },
    ]);
    expect(libraryRoots(storage)).toEqual([
      { path: VOLUME_A.moviesPath, kind: "movie" },
      { path: VOLUME_A.televisionPath, kind: "series" },
      { path: VOLUME_B.moviesPath, kind: "movie" },
      { path: VOLUME_B.televisionPath, kind: "series" },
    ]);
  });

  test("libraryRootFor uses the download dir's volume, not volumes[0]", () => {
    const storage = {
      volumes: VOLUMES,
      organizationStrategy: "hardlink" as const,
    };
    expect(
      libraryRootFor(
        storage,
        `${VOLUME_B.downloadsPath}/${DOWNLOAD_A}`,
        "movie",
      ),
    ).toBe(VOLUME_B.moviesPath);
    expect(
      libraryRootFor(
        storage,
        `${VOLUME_B.downloadsPath}/${DOWNLOAD_A}`,
        "series",
      ),
    ).toBe(VOLUME_B.televisionPath);
  });

  test("uncoveredStoragePaths lists files left without a volume", () => {
    expect(
      uncoveredStoragePaths({
        volumes: [VOLUME_B],
        libraryFilePaths: [`${VOLUME_A.moviesPath}/Keep.mkv`],
        downloadDirectories: [`${VOLUME_A.downloadsPath}/${DOWNLOAD_A}`],
      }),
    ).toEqual([
      `${VOLUME_A.moviesPath}/Keep.mkv`,
      `${VOLUME_A.downloadsPath}/${DOWNLOAD_A}`,
    ]);
    expect(
      uncoveredStoragePaths({
        volumes: VOLUMES,
        libraryFilePaths: [`${VOLUME_A.moviesPath}/Keep.mkv`],
        downloadDirectories: [`${VOLUME_B.downloadsPath}/${DOWNLOAD_A}`],
      }),
    ).toEqual([]);
  });

  test("storageLayoutEquals compares volumes and strategy", () => {
    const left = {
      volumes: VOLUMES,
      organizationStrategy: "hardlink" as const,
    };
    expect(storageLayoutEquals(left, left)).toBe(true);
    expect(
      storageLayoutEquals(left, { ...left, organizationStrategy: "copy" }),
    ).toBe(false);
    expect(storageLayoutEquals(left, { ...left, volumes: [VOLUME_A] })).toBe(
      false,
    );
  });
});

describe("settings storage parse", () => {
  test("legacy three scalars wrap to default volume", () => {
    const settings = AppSettingsSchema.parse({
      storage: {
        downloadsPath: "/mnt/downloads",
        moviesPath: "/mnt/movies",
        televisionPath: "/mnt/tv",
        organizationStrategy: "copy",
      },
    });
    expect(settings.storage).toEqual({
      volumes: [
        {
          id: "default",
          label: "Default",
          downloadsPath: "/mnt/downloads",
          moviesPath: "/mnt/movies",
          televisionPath: "/mnt/tv",
        },
      ],
      organizationStrategy: "copy",
    });
    expect("downloadsPath" in settings.storage).toBe(false);
  });

  test("volumes[] round-trips", () => {
    const settings = AppSettingsSchema.parse({
      storage: {
        volumes: VOLUMES,
        organizationStrategy: "symlink",
      },
    });
    expect(settings.storage.volumes).toEqual([...VOLUMES]);
    expect(settings.storage.organizationStrategy).toBe("symlink");
  });

  test("leftover scalars dropped when volumes present", () => {
    const settings = AppSettingsSchema.parse({
      storage: {
        volumes: [VOLUME_A],
        downloadsPath: "/legacy/downloads",
        moviesPath: "/legacy/movies",
        televisionPath: "/legacy/tv",
        organizationStrategy: "hardlink",
      },
    });
    expect(settings.storage.volumes).toEqual([VOLUME_A]);
    expect("downloadsPath" in settings.storage).toBe(false);
  });

  test("empty volumes rejected", () => {
    expect(() =>
      AppSettingsSchema.parse({
        storage: { volumes: [], organizationStrategy: "hardlink" },
      }),
    ).toThrow();
  });

  test("filesystem root is not a valid volume path", () => {
    expect(() =>
      AppSettingsSchema.parse({
        storage: {
          volumes: [
            {
              id: "default",
              label: "Default",
              downloadsPath: "/",
              moviesPath: "/media/movies",
              televisionPath: "/media/tv",
            },
          ],
          organizationStrategy: "hardlink",
        },
      }),
    ).toThrow();
  });

  test("default is one volume at /media/{downloads,movies,tv}", () => {
    expect(AppSettingsSchema.parse({}).storage).toEqual({
      volumes: [
        {
          id: "default",
          label: "Default",
          downloadsPath: "/media/downloads",
          moviesPath: "/media/movies",
          televisionPath: "/media/tv",
        },
      ],
      organizationStrategy: "hardlink",
    });
  });
});
