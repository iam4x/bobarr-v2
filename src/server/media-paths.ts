import type { StorageVolume } from "../contracts";

import { mkdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, posix, resolve } from "node:path";

export type HostMediaMount = {
  hostPath: string;
  containerRoot: string;
  name: string;
};

export type MediaRoot = {
  name: string;
  root: string;
};

export function parseHostMediaPaths(
  environment: Record<string, string | undefined> = {},
): string[] {
  const raw =
    environment["BOBARR_MEDIA_PATHS"]?.trim() ||
    environment["BOBARR_MEDIA_PATH"]?.trim() ||
    "./media";
  const paths = raw
    .split(",")
    .map((path) => expandHome(path.trim()))
    .filter((path) => path.length > 0);
  if (paths.length === 0) {
    throw new Error("BOBARR_MEDIA_PATHS must list at least one host folder");
  }
  return paths;
}

export function containerRootForIndex(index: number): string {
  return index === 0 ? "/media" : `/media-${index + 1}`;
}

export function mediaPathPlan(hostPaths: readonly string[]): HostMediaMount[] {
  const usedNames = new Set<string>();
  return hostPaths.map((hostPath, index) => {
    const name = uniqueName(nameFromHostPath(hostPath), usedNames);
    usedNames.add(name);
    return {
      hostPath,
      containerRoot: containerRootForIndex(index),
      name,
    };
  });
}

export function mediaRootsEnv(plan: readonly HostMediaMount[]): string {
  return plan.map((item) => `${item.name}:${item.containerRoot}`).join(",");
}

export function parseMediaRootsEnv(raw: string | undefined): MediaRoot[] {
  if (raw === undefined || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map(parseMediaRoot);
}

export function extraComposeYaml(
  plan: readonly HostMediaMount[],
): string | null {
  const extras = plan.slice(1);
  if (extras.length === 0) return null;
  const roots = mediaRootsEnv(plan);
  const bobarrVolumes = extras
    .map((item) => `      - ${yamlString(item.hostPath)}:${item.containerRoot}`)
    .join("\n");
  const transmissionVolumes = extras
    .map(
      (item) =>
        `      - ${yamlString(`${item.hostPath}/downloads`)}:${item.containerRoot}/downloads`,
    )
    .join("\n");
  return `services:
  bobarr:
    environment:
      BOBARR_MEDIA_ROOTS: ${yamlString(roots)}
    volumes:
${bobarrVolumes}
  transmission:
    volumes:
${transmissionVolumes}
`;
}

const MEDIA_CHILDREN = ["downloads", "movies", "tv"] as const;

export async function ensureMediaLayout(hostPath: string): Promise<void> {
  const root = resolve(hostPath);
  const rootInfo = await stat(root).catch((error: unknown) => {
    if (isNotFound(error)) {
      throw new Error(
        `Media folder does not exist: ${root}. Mount the disk first; Bobarr will not create it.`,
      );
    }
    throw error;
  });
  if (!rootInfo.isDirectory()) {
    throw new Error(`Media path is not a directory: ${root}`);
  }
  for (const child of MEDIA_CHILDREN) {
    const childPath = join(root, child);
    try {
      await mkdir(childPath);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const childInfo = await stat(childPath);
    if (!childInfo.isDirectory()) {
      throw new Error(`${childPath} exists and is not a directory`);
    }
  }
}

export async function sameMediaRoot(
  left: string,
  right: string,
): Promise<boolean> {
  const [resolvedLeft, resolvedRight] = await Promise.all([
    realpath(resolve(left)).catch(() => resolve(left)),
    realpath(resolve(right)).catch(() => resolve(right)),
  ]);
  return resolvedLeft === resolvedRight;
}

export function volumesForMediaRoots(
  volumes: readonly StorageVolume[],
  roots: readonly MediaRoot[],
): StorageVolume[] {
  const next = [...volumes];
  const usedIds = new Set(next.map((volume) => volume.id));
  for (const root of roots) {
    if (next.some((volume) => volumeUsesRoot(volume, root.root))) continue;
    const id = uniqueVolumeId(slugVolumeId(root.name), usedIds);
    usedIds.add(id);
    next.push({
      id,
      label: root.name.slice(0, 100) || id,
      downloadsPath: posix.join(root.root, "downloads"),
      moviesPath: posix.join(root.root, "movies"),
      televisionPath: posix.join(root.root, "tv"),
    });
  }
  return next;
}

function parseMediaRoot(item: string): MediaRoot {
  const separator = item.indexOf(":/");
  if (separator === -1) {
    return { name: nameFromHostPath(item), root: item };
  }
  const name = item.slice(0, separator).trim();
  const root = item.slice(separator + 1).trim();
  return { name: name || nameFromHostPath(root), root };
}

function volumeUsesRoot(volume: StorageVolume, root: string): boolean {
  const prefix = posix.normalize(root);
  return [volume.downloadsPath, volume.moviesPath, volume.televisionPath].some(
    (path) => {
      const normalized = posix.normalize(path);
      return (
        normalized === prefix || normalized.startsWith(`${prefix}${posix.sep}`)
      );
    },
  );
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return `${homedir()}/${path.slice(2)}`;
  return path;
}

function nameFromHostPath(path: string): string {
  const name = basename(path.replace(/\/+$/, ""));
  return name || "media";
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) return name;
  let n = 2;
  while (used.has(`${name}-${n}`)) n += 1;
  return `${name}-${n}`;
}

function slugVolumeId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (/^[a-z][a-z0-9-]{0,63}$/.test(slug)) return slug.slice(0, 64);
  const withPrefix = `volume-${slug}`.replace(/-+$/g, "").slice(0, 64);
  return /^[a-z][a-z0-9-]{0,63}$/.test(withPrefix) ? withPrefix : "volume";
}

function uniqueVolumeId(id: string, used: Set<string>): string {
  if (!used.has(id)) return id;
  let n = 2;
  while (used.has(`${id}-${n}`)) n += 1;
  return `${id}-${n}`.slice(0, 64);
}

function yamlString(value: string): string {
  if (value === "" || /[:#{}[\],&*?|>!%@`'"]/.test(value) || /\s/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
