import type { AppSettings, StorageVolume } from "../contracts";

import { createHash } from "node:crypto";
import { access, stat, statfs } from "node:fs/promises";
import { posix } from "node:path";

import { isPathContained } from "./library/paths";

export const STORAGE_RESERVE_BYTES = 10n * 1024n * 1024n * 1024n;

export type LibraryRoot = { path: string; kind: "movie" | "series" };

type StorageLayout = {
  volumes: readonly StorageVolume[];
  organizationStrategy: AppSettings["storage"]["organizationStrategy"];
};

export function libraryRoots(
  storage: StorageLayout,
  kind?: "movie" | "series",
): LibraryRoot[] {
  const roots: LibraryRoot[] = [];
  for (const volume of storage.volumes) {
    if (kind === undefined || kind === "movie") {
      roots.push({ path: volume.moviesPath, kind: "movie" });
    }
    if (kind === undefined || kind === "series") {
      roots.push({ path: volume.televisionPath, kind: "series" });
    }
  }
  return roots;
}

export function downloadRoots(storage: StorageLayout): string[] {
  return storage.volumes.map((volume) => volume.downloadsPath);
}

export function libraryPaths(storage: StorageLayout): string[] {
  return storage.volumes.flatMap((volume) => [
    volume.moviesPath,
    volume.televisionPath,
  ]);
}

export function readablePaths(storage: StorageLayout): string[] {
  return [...libraryPaths(storage), ...downloadRoots(storage)];
}

export function libraryRootFor(
  storage: StorageLayout,
  downloadDirectory: string,
  kind: "movie" | "series",
): string {
  const parent = posix.normalize(posix.dirname(downloadDirectory));
  const volume = storage.volumes.find(
    (candidate) => posix.normalize(candidate.downloadsPath) === parent,
  );
  if (volume === undefined) {
    throw new Error("Download directory is not under a configured volume");
  }
  return kind === "movie" ? volume.moviesPath : volume.televisionPath;
}

export function storageVolumesEqual(
  left: readonly StorageVolume[],
  right: readonly StorageVolume[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((volume, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      volume.id === other.id &&
      volume.label === other.label &&
      volume.downloadsPath === other.downloadsPath &&
      volume.moviesPath === other.moviesPath &&
      volume.televisionPath === other.televisionPath
    );
  });
}

export function storageLayoutEquals(
  left: StorageLayout,
  right: StorageLayout,
): boolean {
  return (
    left.organizationStrategy === right.organizationStrategy &&
    storageVolumesEqual(left.volumes, right.volumes)
  );
}

export function uncoveredStoragePaths(input: {
  volumes: readonly StorageVolume[];
  libraryFilePaths: readonly string[];
  downloadDirectories: readonly string[];
}): string[] {
  const layout = {
    volumes: input.volumes,
    organizationStrategy: "hardlink" as const,
  };
  const library = libraryPaths(layout);
  const downloads = downloadRoots(layout);
  const uncovered: string[] = [];
  for (const path of input.libraryFilePaths) {
    if (!library.some((root) => isPathContained(root, path))) {
      uncovered.push(path);
    }
  }
  for (const path of input.downloadDirectories) {
    if (!downloads.some((root) => isPathContained(root, path))) {
      uncovered.push(path);
    }
  }
  return uncovered;
}

export function placeDownload(input: {
  volumes: readonly StorageVolume[];
  freeBytesByVolumeId: ReadonlyMap<string, bigint>;
  downloadId: string;
}): { volumeId: string; downloadDirectory: string } {
  const measured = input.volumes.filter((volume) =>
    input.freeBytesByVolumeId.has(volume.id),
  );
  if (measured.length === 0) {
    throw new Error("No storage volume could be measured");
  }
  const eligible = measured.filter((volume) => {
    const freeBytes = input.freeBytesByVolumeId.get(volume.id);
    return freeBytes !== undefined && freeBytes > STORAGE_RESERVE_BYTES;
  });
  const pool = eligible.length > 0 ? eligible : measured;
  const selected = pickVolume(
    pool,
    input.freeBytesByVolumeId,
    input.downloadId,
  );
  return {
    volumeId: selected.id,
    downloadDirectory: posix.join(selected.downloadsPath, input.downloadId),
  };
}

export async function measureFreeBytes(path: string): Promise<bigint | null> {
  try {
    const stats = await statfs(path);
    return BigInt(stats.bavail) * BigInt(stats.bsize);
  } catch {
    return null;
  }
}

export async function validateStorage(storage: StorageLayout): Promise<{
  valid: boolean;
  message: string;
  volumes: Array<{
    id: string;
    label: string;
    freeBytes: number | null;
    ok: boolean;
    message?: string;
  }>;
}> {
  const volumes = await Promise.all(
    storage.volumes.map((volume) =>
      validateVolume(volume, storage.organizationStrategy),
    ),
  );
  const overlapping = storageRootsOverlap(storage);
  const valid = !overlapping && volumes.every((volume) => volume.ok);
  let message = "Storage roots are accessible";
  if (overlapping) {
    message = "Configured storage paths overlap";
  } else if (!valid) {
    message =
      volumes.find((volume) => !volume.ok)?.message ??
      "Storage validation failed";
  }
  return { valid, message, volumes };
}

function pickVolume(
  pool: readonly StorageVolume[],
  freeBytesByVolumeId: ReadonlyMap<string, bigint>,
  downloadId: string,
): StorageVolume {
  const first = pool[0];
  if (first === undefined) {
    throw new Error("No storage volume could be measured");
  }
  let selected = first;
  for (const volume of pool.slice(1)) {
    const volumeFree = freeBytesByVolumeId.get(volume.id);
    const selectedFree = freeBytesByVolumeId.get(selected.id);
    if (volumeFree === undefined || selectedFree === undefined) continue;
    if (volumeFree > selectedFree) {
      selected = volume;
      continue;
    }
    if (volumeFree < selectedFree) continue;
    if (
      volumeTieBreak(downloadId, volume.id) <
      volumeTieBreak(downloadId, selected.id)
    ) {
      selected = volume;
    }
  }
  return selected;
}

function volumeTieBreak(downloadId: string, volumeId: string): number {
  const digest = createHash("sha256")
    .update(`${downloadId}:${volumeId}`)
    .digest();
  return digest.readUInt32BE(0);
}

function storageRootsOverlap(storage: StorageLayout): boolean {
  const paths = storage.volumes.flatMap((volume) => [
    volume.downloadsPath,
    volume.moviesPath,
    volume.televisionPath,
  ]);
  for (let i = 0; i < paths.length; i += 1) {
    const left = paths[i];
    if (left === undefined) continue;
    for (let j = 0; j < paths.length; j += 1) {
      if (i === j) continue;
      const right = paths[j];
      if (right === undefined) continue;
      if (isPathContained(left, right)) return true;
    }
  }
  return false;
}

async function validateVolume(
  volume: StorageVolume,
  strategy: AppSettings["storage"]["organizationStrategy"],
): Promise<{
  id: string;
  label: string;
  freeBytes: number | null;
  ok: boolean;
  message?: string;
}> {
  const paths = [
    volume.downloadsPath,
    volume.moviesPath,
    volume.televisionPath,
  ];
  const freeBytes = jsonFreeBytes(await measureFreeBytes(volume.downloadsPath));
  try {
    for (const path of paths) {
      await access(path);
      if (!(await stat(path)).isDirectory()) {
        return {
          id: volume.id,
          label: volume.label,
          freeBytes,
          ok: false,
          message: `${path} is not a directory`,
        };
      }
    }
    if (strategy === "hardlink") {
      const devices = await Promise.all(
        paths.map(async (path) => (await stat(path)).dev),
      );
      if (new Set(devices).size !== 1) {
        return {
          id: volume.id,
          label: volume.label,
          freeBytes,
          ok: false,
          message:
            "Hardlinks require downloads and library roots on one filesystem",
        };
      }
    }
    return { id: volume.id, label: volume.label, freeBytes, ok: true };
  } catch (error) {
    return {
      id: volume.id,
      label: volume.label,
      freeBytes,
      ok: false,
      message:
        error instanceof Error ? error.message : "Storage validation failed",
    };
  }
}

function jsonFreeBytes(value: bigint | null): number | null {
  if (value === null) return null;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  if (value < 0n) return 0;
  return Number(value);
}
