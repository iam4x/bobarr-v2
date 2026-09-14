import type { LibraryFile, StorageVolume } from "../../contracts";
import type { BackendDatabase, Repositories } from "../db";
import type { FileIdentity } from "../db/volume-transfers";
import type { TorrentEngine } from "../integrations/transmission";
import type { MediaStorageGroup } from "./volume-placement";

import { lstat, readdir, readlink, realpath } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";

import { parseExistingEpisodeIdentity } from "./importer";
import { isPathContained } from "./paths";
import { groupForMedia, listLibraryGroups } from "./volume-placement";
import { isOwnedTorrentIdentity } from "../application/torrent-ownership";
import { isMediaMutating } from "../db/volume-transfers";

export interface InventoryFile {
  path: string;
  root: string;
  volumeId: string;
  identity: FileIdentity;
}

export interface InventoryDownload {
  id: string;
  hash: string | null;
  label: string | null;
  source: string;
  volumeId: string;
  running: boolean;
  files: { index: number; name: string; length: number; wanted: boolean }[];
}

export interface GroupInventory {
  key: string;
  groups: MediaStorageGroup[];
  title: string;
  mediaIds: string[];
  files: InventoryFile[];
  libraryFiles: LibraryFile[];
  downloads: InventoryDownload[];
  directories: string[];
  bytesByVolume: Map<string, bigint>;
}

type InspectedGroup = Omit<
  GroupInventory,
  "key" | "groups" | "bytesByVolume"
> & {
  group: MediaStorageGroup;
};

type DownloadInspection = { files: InventoryFile[] } & (
  | { kind: "ready"; download: InventoryDownload | null }
  | { kind: "skipped"; reason: string }
);

interface DownloadRow {
  id: string;
  media_item_id: string | null;
  download_directory: string | null;
  download_path: string | null;
  engine_info_hash: string | null;
  external_id: string | null;
  engine_label: string | null;
  acquisition_state: string | null;
  state: string;
}

interface InventoryOptions {
  database: BackendDatabase;
  repositories: Repositories;
  volumes: readonly StorageVolume[];
  transmission: () => Promise<TorrentEngine>;
  signal: AbortSignal;
  heartbeat: () => Promise<void>;
  skipped: (key: string, reason: string) => void;
}

export async function inventoryLibrary(
  options: InventoryOptions,
): Promise<GroupInventory[]> {
  const groups = listLibraryGroups(options.repositories);
  const groupByKey = new Map(groups.map((group) => [group.key, group]));
  const dependencies = new Map<string, Set<string>>();
  const connect = (owners: Iterable<string>): void => {
    const keys = [...new Set(owners)];
    for (const key of keys) {
      const neighbors = dependencies.get(key) ?? new Set<string>();
      for (const other of keys) if (other !== key) neighbors.add(other);
      dependencies.set(key, neighbors);
    }
  };
  const canonicalRoots = new Map<string, string>();
  for (const volume of options.volumes) {
    for (const path of [
      volume.downloadsPath,
      volume.moviesPath,
      volume.televisionPath,
    ])
      canonicalRoots.set(path, await realpath(path));
  }
  const groupByFileId = new Map(
    groups.flatMap((group) =>
      group.files.map((file) => [file.id, group.key] as const),
    ),
  );
  const ownersByInode = new Map<string, Set<string>>();
  const ownersByPath = new Map<string, string>();
  const downloadGroups = new Map<string, Set<string>>();
  const records = options.database.sqlite
    .query<{ id: string; path: string; download_id: string | null }, []>(
      "SELECT id, path, download_id FROM library_files",
    )
    .all();
  for (const file of records) {
    options.signal.throwIfAborted();
    const owner = groupByFileId.get(file.id) ?? `file:${file.id}`;
    ownersByPath.set(resolve(file.path), owner);
    if (file.download_id !== null) {
      const keys = downloadGroups.get(file.download_id) ?? new Set<string>();
      keys.add(owner);
      downloadGroups.set(file.download_id, keys);
    }
    if (!groupByFileId.has(file.id))
      options.skipped(
        owner,
        `The movie or season could not be identified for ${file.path}`,
      );
    const canonical = await realpath(file.path).catch(() => null);
    const info = canonical === null ? null : await lstatOrMissing(canonical);
    if (info?.isFile()) {
      const inode = `${info.dev}:${info.ino}`;
      const owners = ownersByInode.get(inode) ?? new Set<string>();
      owners.add(owner);
      ownersByInode.set(inode, owners);
      connect(owners);
    }
  }
  const rememberFile = (
    file: InventoryFile,
    owners: Iterable<string>,
  ): void => {
    const inode = `${file.identity.dev}:${file.identity.ino}`;
    const related = ownersByInode.get(inode) ?? new Set<string>();
    for (const owner of owners) related.add(owner);
    const pathOwner = ownersByPath.get(file.path);
    if (pathOwner) related.add(pathOwner);
    ownersByInode.set(inode, related);
    connect(related);
  };
  const downloads = options.database.sqlite
    .query<DownloadRow, []>(`
    SELECT id, media_item_id, download_directory, download_path,
      engine_info_hash, external_id, engine_label, acquisition_state, state
    FROM downloads
  `)
    .all();
  const inspectedDownloads = new Map<string, DownloadInspection>();
  const problems = new Map<string, string>();
  for (const download of downloads) {
    options.signal.throwIfAborted();
    await options.heartbeat();
    const owners = downloadGroups.get(download.id) ?? new Set<string>();
    const mediaGroup = download.media_item_id
      ? groupForMedia(download.media_item_id, options.repositories)
      : null;
    if (mediaGroup && groupByKey.has(mediaGroup.key))
      owners.add(mediaGroup.key);
    if (owners.size === 0) owners.add(`download:${download.id}`);
    downloadGroups.set(download.id, owners);
    connect(owners);
    const inspection = await inspectDownload(download, canonicalRoots, options);
    inspectedDownloads.set(download.id, inspection);
    for (const file of inspection.files) rememberFile(file, owners);
    if (inspection.kind === "skipped") {
      for (const owner of owners) problems.set(owner, inspection.reason);
    }
  }
  const inspectedGroups = new Map<string, InspectedGroup>();
  for (const group of groups) {
    options.signal.throwIfAborted();
    await options.heartbeat();
    try {
      const mediaIds = groupMediaIds(group);
      if (isMediaMutating(options.database, mediaIds)) {
        throw new Error("A download or library change is in progress");
      }
      const roots = options.volumes.flatMap((volume) => {
        const path =
          group.kind === "movie" ? volume.moviesPath : volume.televisionPath;
        return [...new Set([resolve(path), canonicalRoots.get(path)!])].map(
          (root) => ({ volumeId: volume.id, path: root }),
        );
      });
      const entries = new Map<string, InventoryFile>();
      const directories = new Set<string>();
      for (const record of group.files) {
        const root = roots.find((candidate) =>
          isPathContained(candidate.path, record.path),
        );
        if (!root)
          throw new Error("A recorded file is outside the configured volumes");
        const folder = groupFolder(record.path, root.path, group);
        if (folder) {
          connect([
            group.key,
            ...records
              .filter((file) => isPathContained(folder, file.path))
              .map((file) => groupByFileId.get(file.id) ?? `file:${file.id}`),
          ]);
          directories.add(folder);
          for (const file of await walkFiles(
            folder,
            root.path,
            root.volumeId,
            options.signal,
          ))
            entries.set(file.path, file);
        } else {
          for (const file of await flatGroupFiles(
            record.path,
            root.path,
            root.volumeId,
            group,
            options.signal,
          ))
            entries.set(file.path, file);
        }
        if (!entries.has(resolve(record.path)))
          throw new Error(`Recorded library file is missing: ${record.path}`);
      }
      const groupDownloads: InventoryDownload[] = [];
      for (const [downloadId, inspection] of inspectedDownloads) {
        if (!downloadGroups.get(downloadId)?.has(group.key)) continue;
        for (const file of inspection.files) entries.set(file.path, file);
        if (inspection.kind === "ready" && inspection.download) {
          groupDownloads.push(inspection.download);
          directories.add(inspection.download.source);
        }
      }
      for (const entry of entries.values()) {
        rememberFile(entry, [group.key]);
      }
      inspectedGroups.set(group.key, {
        group,
        title:
          options.repositories.media.get(group.mediaIds[0] ?? "")?.title ??
          group.key,
        mediaIds,
        files: [...entries.values()],
        libraryFiles: group.files,
        downloads: groupDownloads,
        directories: [...directories],
      });
    } catch (error) {
      options.signal.throwIfAborted();
      problems.set(
        group.key,
        error instanceof Error ? error.message : "Could not inspect this media",
      );
    }
  }
  const result: GroupInventory[] = [];
  const visited = new Set<string>();
  for (const group of groups) {
    if (visited.has(group.key)) continue;
    const component: string[] = [];
    const pending = [group.key];
    while (pending.length > 0) {
      const key = pending.pop();
      if (key === undefined || visited.has(key)) continue;
      visited.add(key);
      component.push(key);
      pending.push(...(dependencies.get(key) ?? []));
    }
    const keys = component.filter((key) => groupByKey.has(key)).sort();
    const key = keys.join("|");
    const unresolved = component.find((owner) => !groupByKey.has(owner));
    const problem = component.flatMap((owner) =>
      problems.has(owner) ? [problems.get(owner)!] : [],
    )[0];
    if (unresolved || problem) {
      options.skipped(
        key,
        unresolved
          ? `Shared payload ownership could not be identified for ${unresolved}`
          : problem!,
      );
      continue;
    }
    result.push(
      mergeInventories(
        key,
        keys.map((owner) => inspectedGroups.get(owner)!),
      ),
    );
  }
  return result;
}

async function inspectDownload(
  row: DownloadRow,
  canonicalRoots: ReadonlyMap<string, string>,
  options: InventoryOptions,
): Promise<DownloadInspection> {
  let files: InventoryFile[] = [];
  try {
    const source = row.download_directory ?? row.download_path;
    const removed =
      row.acquisition_state === "removed" || row.state === "removed";
    const recordedHash = row.engine_info_hash ?? row.external_id;
    const neverOwned =
      recordedHash === null &&
      row.engine_label === null &&
      row.acquisition_state === null;
    if (!source) {
      if (!removed && !neverOwned)
        throw new Error("A linked download directory is unavailable");
      return { kind: "ready", files, download: null };
    }
    const volume = options.volumes.find(
      (candidate) =>
        resolve(candidate.downloadsPath, row.id) === resolve(source) ||
        resolve(canonicalRoots.get(candidate.downloadsPath)!, row.id) ===
          resolve(source),
    );
    if (!volume)
      throw new Error(
        "A linked download directory is outside its managed volume",
      );
    const info = await lstatOrMissing(source);
    if (!info) {
      if (!removed && !neverOwned)
        throw new Error("A linked download directory is unavailable");
      return { kind: "ready", files, download: null };
    }
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("A download directory is not a regular directory");
    files = await walkFiles(source, dirname(source), volume.id, options.signal);
    if (
      !removed &&
      (row.acquisition_state !== null
        ? row.acquisition_state !== "organized"
        : row.state !== "completed")
    ) {
      throw new Error("A linked download has not finished organizing");
    }
    const download: InventoryDownload = {
      id: row.id,
      hash: null,
      label: null,
      source: resolve(source),
      volumeId: volume.id,
      running: false,
      files: [],
    };
    if (!removed && !neverOwned) {
      if (recordedHash === null || row.engine_label === null)
        throw new Error("Linked torrent ownership could not be verified");
      const torrent = await (
        await options.transmission()
      ).get(recordedHash, options.signal);
      if (!torrent)
        throw new Error(
          "The linked torrent is unavailable in Transmission; retry after it is restored",
        );
      const label = `bobarr:${row.id}`;
      if (
        !isOwnedTorrentIdentity(
          {
            id: row.id,
            engineLabel: row.engine_label,
            engineInfoHash: recordedHash,
            expectedInfoHash: null,
          },
          torrent,
        ) ||
        (await realpath(torrent.downloadDirectory)) !== (await realpath(source))
      ) {
        throw new Error(
          "Linked torrent ownership or directory could not be verified",
        );
      }
      if (torrent.metadataProgress < 1 || torrent.files.length === 0)
        throw new Error("Linked torrent file metadata is unavailable");
      if (
        torrent.progress < 1 ||
        torrent.files.some(
          (file) => file.wanted && file.bytesCompleted < file.length,
        )
      ) {
        throw new Error("A linked torrent is still downloading");
      }
      download.hash = recordedHash;
      download.label = label;
      download.running = torrent.status !== "stopped";
      download.files = torrent.files
        .map(({ index, name, length, wanted }) => ({
          index,
          name,
          length,
          wanted,
        }))
        .sort(
          (left, right) =>
            left.index - right.index || left.name.localeCompare(right.name),
        );
    }
    return { kind: "ready", files, download };
  } catch (error) {
    options.signal.throwIfAborted();
    return {
      kind: "skipped",
      files,
      reason:
        error instanceof Error
          ? error.message
          : "Could not inspect this download",
    };
  }
}

function mergeInventories(
  key: string,
  inventories: InspectedGroup[],
): GroupInventory {
  const files = [
    ...new Map(
      inventories.flatMap((group) =>
        group.files.map((file) => [file.path, file] as const),
      ),
    ).values(),
  ];
  const bytesByVolume = new Map<string, bigint>();
  const counted = new Set<string>();
  for (const file of files) {
    const inode = `${file.identity.dev}:${file.identity.ino}`;
    if (file.identity.link !== null || counted.has(inode)) continue;
    counted.add(inode);
    bytesByVolume.set(
      file.volumeId,
      (bytesByVolume.get(file.volumeId) ?? 0n) + BigInt(file.identity.size),
    );
  }
  return {
    key,
    groups: inventories.map((inventory) => inventory.group),
    title: inventories.map((inventory) => inventory.title).join(", "),
    mediaIds: [
      ...new Set(inventories.flatMap((inventory) => inventory.mediaIds)),
    ],
    files,
    libraryFiles: [
      ...new Map(
        inventories.flatMap((inventory) =>
          inventory.libraryFiles.map((file) => [file.id, file] as const),
        ),
      ).values(),
    ],
    downloads: [
      ...new Map(
        inventories.flatMap((inventory) =>
          inventory.downloads.map(
            (download) => [download.id, download] as const,
          ),
        ),
      ).values(),
    ],
    directories: [
      ...new Set(inventories.flatMap((inventory) => inventory.directories)),
    ],
    bytesByVolume,
  };
}

function groupMediaIds(
  group: MediaStorageGroup & { files: LibraryFile[] },
): string[] {
  return [
    ...new Set([...group.mediaIds, ...group.files.map((file) => file.mediaId)]),
  ];
}

function groupFolder(
  path: string,
  root: string,
  group: MediaStorageGroup,
): string | null {
  const parts = relative(root, path).split(sep);
  if (group.kind === "movie")
    return parts.length > 1 ? resolve(root, parts[0]!) : null;
  for (let index = 1; index < parts.length - 1; index += 1) {
    const match = /^(?:season[ ._-]*|s)(\d{1,3})$/i.exec(parts[index]!);
    if (match && Number(match[1]) === group.seasonNumber)
      return resolve(root, ...parts.slice(0, index + 1));
  }
  return null;
}

async function flatGroupFiles(
  path: string,
  root: string,
  volumeId: string,
  group: MediaStorageGroup,
  signal: AbortSignal,
): Promise<InventoryFile[]> {
  const parent = dirname(path);
  await validateDirectory(root, parent);
  const stem = basename(path, extname(path));
  const result: InventoryFile[] = [];
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    const candidate = resolve(parent, entry.name);
    const identity = parseExistingEpisodeIdentity(candidate);
    if (
      candidate !== resolve(path) &&
      !(group.kind === "season" && identity.season === group.seasonNumber) &&
      !entry.name.startsWith(`${stem}.`)
    )
      continue;
    signal.throwIfAborted();
    if (entry.isDirectory()) continue;
    result.push(await inventoryFile(candidate, root, volumeId));
  }
  return result;
}

async function walkFiles(
  directory: string,
  root: string,
  volumeId: string,
  signal: AbortSignal,
): Promise<InventoryFile[]> {
  await validateDirectory(root, directory);
  const result: InventoryFile[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    signal.throwIfAborted();
    const path = resolve(directory, entry.name);
    if (entry.isDirectory())
      result.push(...(await walkFiles(path, root, volumeId, signal)));
    else result.push(await inventoryFile(path, root, volumeId));
  }
  return result;
}

async function inventoryFile(
  path: string,
  root: string,
  volumeId: string,
): Promise<InventoryFile> {
  await validateDirectory(root, dirname(path));
  const info = await lstat(path);
  if (!info.isFile() && !info.isSymbolicLink())
    throw new Error(`Unsupported file in media folder: ${path}`);
  return {
    path: resolve(path),
    root: resolve(root),
    volumeId,
    identity: {
      dev: info.dev,
      ino: info.ino,
      size: info.size,
      mtimeMs: info.mtimeMs,
      link: info.isSymbolicLink() ? await readlink(path) : null,
    },
  };
}

export async function validateDirectory(
  root: string,
  directory: string,
): Promise<void> {
  const canonicalRoot = await realpath(root);
  if (!isPathContained(root, directory))
    throw new Error("Directory escapes its storage root");
  let current = resolve(root);
  for (const segment of relative(root, directory).split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`Unsafe directory in storage path: ${current}`);
  }
  const canonicalDirectory = await realpath(directory);
  if (!isPathContained(canonicalRoot, canonicalDirectory))
    throw new Error("Directory resolves outside its storage root");
}

export async function lstatOrMissing(
  path: string,
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}
