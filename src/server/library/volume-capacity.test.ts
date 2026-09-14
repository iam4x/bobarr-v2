import type { StorageVolume } from "../../contracts";

import { afterEach, expect, test } from "bun:test";
import { link, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { measureVolumeBytes } from "./volume-organizer";
import { storageRootsOverlap, validateStorage } from "../storage";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("counts unregistered and active data while counting hardlinks only once", async () => {
  const volume = await createVolume();
  const payload = join(volume.downloadsPath, "unfinished.mkv");
  await Bun.write(payload, "download");
  await link(payload, join(volume.moviesPath, "linked.mkv"));
  await symlink(payload, join(volume.televisionPath, "linked.mkv"));
  await Bun.write(join(volume.moviesPath, "unidentified.mkv"), "unknown");
  const staging = join(volume.moviesPath, ".bobarr-volume-organize");
  await mkdir(staging);
  await Bun.write(join(staging, "partial"), "temporary");
  const used = await measureVolumeBytes([volume], new AbortController().signal);
  expect(used.get(volume.id)).toBe(15n);
});

test("rejects overlapping physical roots hidden behind an alias", async () => {
  const volume = await createVolume();
  const alias = join(roots[0]!, "alias");
  await symlink(volume.moviesPath, alias, "dir");
  const overlapping = { ...volume, televisionPath: alias };
  expect(await storageRootsOverlap([volume])).toBe(false);
  expect(await storageRootsOverlap([overlapping])).toBe(true);
  expect(
    await validateStorage({
      volumes: [overlapping],
      organizationStrategy: "copy",
    }),
  ).toMatchObject({
    valid: false,
    message: "Configured storage paths overlap",
  });
});

test("rejects a volume that aliases another volume's directories", async () => {
  const volume = await createVolume();
  const alias = join(roots[0]!, "alias");
  await symlink(roots[0]!, alias, "dir");
  const second = {
    id: "alias",
    label: "Alias",
    downloadsPath: join(alias, "downloads"),
    moviesPath: join(alias, "movies"),
    televisionPath: join(alias, "tv"),
  };
  expect(await storageRootsOverlap([volume, second])).toBe(true);
});

async function createVolume(): Promise<StorageVolume> {
  const root = await mkdtemp(join(tmpdir(), "bobarr-volume-capacity-"));
  roots.push(root);
  const volume = {
    id: "volume",
    label: "Volume",
    downloadsPath: join(root, "downloads"),
    moviesPath: join(root, "movies"),
    televisionPath: join(root, "tv"),
  };
  await Promise.all(
    [volume.downloadsPath, volume.moviesPath, volume.televisionPath].map(
      (path) => mkdir(path),
    ),
  );
  return volume;
}
