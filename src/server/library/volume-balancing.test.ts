import type { StorageVolume } from "../../contracts";
import type { GroupInventory } from "./volume-inventory";

import { describe, expect, test } from "bun:test";

import { chooseVolumeMove } from "./volume-organizer";
import { STORAGE_RESERVE_BYTES } from "../storage";

const volumes = ["a", "b"].map(
  (id): StorageVolume => ({
    id,
    label: id,
    downloadsPath: `/${id}/downloads`,
    moviesPath: `/${id}/movies`,
    televisionPath: `/${id}/tv`,
  }),
);
const free = new Map(
  volumes.map((volume) => [volume.id, STORAGE_RESERVE_BYTES + 1_000n]),
);

describe("whole-group volume balancing", () => {
  test("moves an uneven library to equal shares without splitting groups", () => {
    const groups = [30, 20, 15, 15, 10].map((size, index) =>
      group(`movie-${index}`, "a", size),
    );
    expect(balance(groups)).toEqual([45n, 45n]);
  });

  test("finds a swap when no single move improves the balance", () => {
    const groups = [
      group("eight", "a", 8),
      group("seven", "a", 7),
      group("six", "b", 6),
      group("five", "b", 5),
    ];
    expect(balance(groups)).toEqual([13n, 13n]);
  });

  test("leaves balanced groups in place", () => {
    expect(
      chooseVolumeMove(
        [group("a", "a", 13), group("b", "b", 13)],
        volumes,
        free,
      ),
    ).toBeNull();
  });

  test("accounts for data that cannot move when choosing a destination", () => {
    const groups = [group("first", "a", 10), group("second", "b", 10)];
    const usedBytes = new Map([
      ["a", 100n],
      ["b", 10n],
    ]);
    const move = chooseVolumeMove(groups, volumes, free, new Set(), usedBytes);
    expect(move?.group.key).toBe("first");
    expect(move?.destination.id).toBe("b");
  });

  test("requires room for the whole group above the storage reserve", () => {
    const constrained = new Map(free);
    constrained.set("b", STORAGE_RESERVE_BYTES + 7n);
    expect(
      chooseVolumeMove(
        [group("first", "a", 8), group("second", "a", 8)],
        volumes,
        constrained,
      ),
    ).toBeNull();
  });

  test("consolidates a split season even when grouping outweighs balance", () => {
    const first = group("season", "a", 5);
    const second = group("season", "b", 5);
    const split = {
      ...first,
      files: [...first.files, ...second.files],
      bytesByVolume: new Map([
        ["a", 5n],
        ["b", 5n],
      ]),
    };
    expect(chooseVolumeMove([split], volumes, free)?.group.key).toBe("season");
  });
});

function balance(initial: GroupInventory[]): bigint[] {
  let groups = initial;
  const moved = new Set<string>();
  for (let index = 0; index < initial.length; index += 1) {
    const move = chooseVolumeMove(groups, volumes, free, moved);
    if (!move) break;
    moved.add(move.group.key);
    groups = groups.map((item) =>
      item.key !== move.group.key
        ? item
        : {
            ...item,
            files: item.files.map((file) => ({
              ...file,
              volumeId: move.destination.id,
            })),
            bytesByVolume: new Map([
              [
                move.destination.id,
                [...item.bytesByVolume.values()].reduce(
                  (total, bytes) => total + bytes,
                  0n,
                ),
              ],
            ]),
          },
    );
  }
  return volumes.map((volume) =>
    groups.reduce(
      (total, item) => total + (item.bytesByVolume.get(volume.id) ?? 0n),
      0n,
    ),
  );
}

function group(key: string, volumeId: string, size: number): GroupInventory {
  return {
    key,
    groups: [
      {
        key,
        kind: "movie",
        mediaIds: [key],
        seriesId: null,
        seasonNumber: null,
      },
    ],
    title: key,
    mediaIds: [key],
    libraryFiles: [],
    downloads: [],
    directories: [],
    files: [
      {
        path: `/${volumeId}/movies/${key}.mkv`,
        root: `/${volumeId}/movies`,
        volumeId,
        identity: { dev: 1, ino: 1, size, mtimeMs: 0, link: null },
      },
    ],
    bytesByVolume: new Map([[volumeId, BigInt(size)]]),
  };
}
