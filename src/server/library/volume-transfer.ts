import type { StorageVolume } from "../../contracts";
import type { BackendDatabase } from "../db";
import type {
  FileIdentity,
  TransferDownload,
  TransferFile,
  VolumeTransfer,
} from "../db/volume-transfers";
import type {
  TorrentEngine,
  TorrentSnapshot,
} from "../integrations/transmission";
import type { GroupInventory } from "./volume-inventory";

import {
  link,
  lstat,
  mkdir,
  open,
  readlink,
  realpath,
  rename,
  rmdir,
  stat,
  symlink,
  unlink,
} from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";

import { isPathContained } from "./paths";
import { lstatOrMissing, validateDirectory } from "./volume-inventory";
import { isOwnedTorrentIdentity } from "../application/torrent-ownership";
import { saveVolumeTransfer } from "../db/volume-transfers";
import { measureFreeBytes, STORAGE_RESERVE_BYTES } from "../storage";

export interface TransferStorageOptions {
  measureFreeBytes?: typeof measureFreeBytes;
  deviceForPath?: (path: string) => Promise<number>;
}

export async function buildVolumeTransfer(
  input: {
    group: GroupInventory;
    volumes: readonly StorageVolume[];
    destination: StorageVolume;
    jobId: string;
  } & TransferStorageOptions,
): Promise<VolumeTransfer> {
  const { group, destination } = input;
  const id = crypto.randomUUID();
  const destinationRoots = {
    downloads: await realpath(destination.downloadsPath),
    movies: await realpath(destination.moviesPath),
    television: await realpath(destination.televisionPath),
  };
  const rootsByVolume = new Map<
    string,
    { downloads: string; movies: string; television: string }
  >();
  for (const volume of input.volumes)
    rootsByVolume.set(volume.id, {
      downloads: await realpath(volume.downloadsPath),
      movies: await realpath(volume.moviesPath),
      television: await realpath(volume.televisionPath),
    });
  const deviceForPath = input.deviceForPath ?? filesystemDevice;
  const destinationDevices = new Map<string, number>();
  for (const root of Object.values(destinationRoots))
    destinationDevices.set(root, await deviceForPath(root));
  const sources = new Map<
    string,
    {
      source: string;
      sourceRoot: string;
      destination: string;
      destinationRoot: string;
      device: number;
    }
  >();
  const destinationsBySource = new Map<string, string>();
  for (const file of group.files) {
    const sourceRoot = await realpath(file.root);
    const source = await canonicalEntry(file.path);
    const roots = rootsByVolume.get(file.volumeId);
    let destinationRoot: string;
    if (sourceRoot === roots?.downloads)
      destinationRoot = destinationRoots.downloads;
    else if (sourceRoot === roots?.movies)
      destinationRoot = destinationRoots.movies;
    else if (sourceRoot === roots?.television)
      destinationRoot = destinationRoots.television;
    else throw new Error("Source volume is no longer configured");
    if (!isPathContained(sourceRoot, source))
      throw new Error("Source entry escapes its storage root");
    const destinationPath = resolve(
      destinationRoot,
      relative(sourceRoot, source),
    );
    const device = destinationDevices.get(destinationRoot);
    if (device === undefined)
      throw new Error("Destination filesystem could not be identified");
    sources.set(file.path, {
      source,
      sourceRoot,
      destination: destinationPath,
      destinationRoot,
      device,
    });
    destinationsBySource.set(source, destinationPath);
  }
  const downloadSources = await Promise.all(
    group.downloads.map((download) => realpath(download.source)),
  );
  const sorted = [...group.files].sort(
    (left, right) =>
      Number(
        !downloadSources.some((root) =>
          isPathContained(root, sources.get(left.path)!.source),
        ),
      ) -
      Number(
        !downloadSources.some((root) =>
          isPathContained(root, sources.get(right.path)!.source),
        ),
      ),
  );
  const primaryByDeviceAndInode = new Map<string, string>();
  const files: TransferFile[] = [];
  for (const [index, file] of sorted.entries()) {
    const paths = sources.get(file.path);
    if (!paths) throw new Error("Missing destination for group file");
    const inode = `${paths.device}:${file.identity.dev}:${file.identity.ino}`;
    const previous = primaryByDeviceAndInode.get(inode);
    let kind: TransferFile["kind"] = "copy";
    let target: string | null = null;
    if (file.identity.link !== null) {
      target = destinationsBySource.get(await realpath(file.path)) ?? null;
      if (target === null)
        throw new Error(
          "A library symlink points to data outside its transfer group",
        );
      kind = "symlink";
    } else if (previous !== undefined && previous !== paths.destination) {
      kind = "hardlink";
      target = previous;
    } else primaryByDeviceAndInode.set(inode, paths.destination);
    files.push({
      source: paths.source,
      sourceRoot: paths.sourceRoot,
      destination: paths.destination,
      destinationRoot: paths.destinationRoot,
      identity: file.identity,
      kind,
      target,
      checksum: null,
      stagingIdentity: null,
      stagingPath: resolve(
        paths.destinationRoot,
        ".bobarr-volume-organize",
        id,
        `${index}.file`,
      ),
    });
  }
  const libraryFiles: VolumeTransfer["libraryFiles"] = [];
  for (const file of group.libraryFiles) {
    const source = await canonicalEntry(file.path);
    const transferFile = files.find((candidate) => candidate.source === source);
    if (!transferFile)
      throw new Error("Recorded file is missing from the transfer inventory");
    let strategy = file.strategy;
    if (transferFile.kind === "symlink") strategy = "symlink";
    else if (transferFile.kind === "hardlink") strategy = "hardlink";
    else if (strategy === "hardlink") strategy = "copy";
    libraryFiles.push({
      id: file.id,
      source: file.path,
      destination: transferFile.destination,
      strategy,
    });
  }
  if (
    new Set(libraryFiles.map((file) => file.destination)).size !==
    libraryFiles.length
  )
    throw new Error("Two recorded files would occupy the same destination");
  const downloads: VolumeTransfer["downloads"] = [];
  for (const download of group.downloads)
    downloads.push({
      id: download.id,
      hash: download.hash,
      label: download.label,
      source: await realpath(download.source),
      recordedSource: download.source,
      destination: resolve(destinationRoots.downloads, download.id),
      running: download.running,
      files: download.files.map((file) => ({ ...file })),
    });
  const stagingRoot = resolve(
    destinationRoots.downloads,
    ".bobarr-volume-organize",
    id,
  );
  const paths = new Set<string>([stagingRoot]);
  for (const directory of group.directories) {
    paths.add(directory);
    paths.add(await realpath(directory));
  }
  for (const file of files) {
    paths.add(file.source);
    paths.add(file.destination);
    paths.add(dirname(file.stagingPath));
  }
  for (const download of downloads) {
    paths.add(download.source);
    paths.add(download.recordedSource);
    paths.add(download.destination);
  }
  const transfer: VolumeTransfer = {
    id,
    groupKey: group.key,
    groupKeys: group.groups.map((member) => member.key),
    jobId: input.jobId,
    title: group.title,
    mediaIds: group.mediaIds,
    destinationVolumeId: destination.id,
    stagingRoot,
    paths: [...paths],
    files,
    libraryFiles,
    downloads,
    stage: "copying",
  };
  await verifyCapacity(transfer, input);
  return transfer;
}

async function canonicalEntry(path: string): Promise<string> {
  return resolve(await realpath(dirname(path)), basename(path));
}

async function sameEntry(
  source: string,
  destination: string,
): Promise<boolean> {
  if ((await canonicalEntry(source)) === (await canonicalEntry(destination)))
    return true;
  if (basename(source) !== basename(destination)) return false;
  const [sourceParent, destinationParent] = await Promise.all([
    stat(dirname(source)),
    stat(dirname(destination)),
  ]);
  return (
    sourceParent.dev === destinationParent.dev &&
    sourceParent.ino === destinationParent.ino
  );
}

async function filesystemDevice(path: string): Promise<number> {
  return (await stat(path)).dev;
}

export async function resumeVolumeTransfer(
  input: {
    database: BackendDatabase;
    transfer: VolumeTransfer;
    transmission: () => Promise<TorrentEngine>;
    signal: AbortSignal;
    heartbeat: () => Promise<void>;
  } & TransferStorageOptions,
): Promise<void> {
  const { transfer, database, signal, heartbeat } = input;
  if (transfer.stage === "complete") return;
  if (transfer.stage === "copying") {
    await verifyCapacity(transfer, input);
    await prepareStaging(transfer);
    for (const file of transfer.files) {
      signal.throwIfAborted();
      await heartbeat();
      if (file.source === file.destination && file.kind !== "copy") {
        const alreadyPublished = await verifyDestination(file, signal).then(
          () => true,
          () => false,
        );
        if (!alreadyPublished) await assertSource(file);
      } else await assertSource(file);
      if (file.kind === "copy") {
        if (file.source === file.destination) {
          file.checksum = await hashFile(file.source, signal);
        } else {
          const staged = file.stagingPath;
          if (
            file.checksum === null ||
            !(await matchesChecksum(staged, file.checksum, signal))
          ) {
            await verifyCapacity(transfer, input);
            const stagedInfo = await lstatOrMissing(staged);
            if (stagedInfo) {
              if (
                !stagedInfo.isFile() ||
                stagedInfo.isSymbolicLink() ||
                !file.stagingIdentity ||
                stagedInfo.dev !== file.stagingIdentity.dev ||
                stagedInfo.ino !== file.stagingIdentity.ino
              )
                throw new Error("Transfer staging file was replaced");
              await unlink(staged);
            }
            const created = await open(staged, "wx");
            const createdInfo = await created.stat();
            await created.close();
            file.stagingIdentity = {
              dev: createdInfo.dev,
              ino: createdInfo.ino,
            };
            saveVolumeTransfer(database, transfer);
            file.checksum = await copyAndHash(file.source, staged, signal);
          }
          if (!(await matchesChecksum(staged, file.checksum, signal)))
            throw new Error(`Copied file failed verification: ${file.source}`);
        }
        await assertSource(file);
        saveVolumeTransfer(database, transfer);
      }
    }
    for (const file of transfer.files) {
      if (file.kind !== "hardlink") continue;
      const primary = transfer.files.find(
        (candidate) =>
          candidate.destination === file.target && candidate.checksum !== null,
      );
      if (!primary?.checksum)
        throw new Error("A hardlink has no verified payload");
      file.checksum = primary.checksum;
    }
    saveVolumeTransfer(database, transfer);
    await verifyTorrents(transfer, input, "source-or-destination");
    for (const file of transfer.files) {
      signal.throwIfAborted();
      await heartbeat();
      await publishFile(file, signal);
    }
    transfer.stage = "published";
    saveVolumeTransfer(database, transfer);
    await heartbeat();
  }
  if (transfer.stage === "published") {
    for (const file of transfer.files) {
      signal.throwIfAborted();
      if (file.source !== file.destination) await assertSource(file);
      await verifyDestination(file, signal);
    }
    for (const download of transfer.downloads) {
      signal.throwIfAborted();
      await heartbeat();
      if (download.hash === null || download.source === download.destination)
        continue;
      const engine = await input.transmission();
      const torrent = await verifyTorrent(
        download,
        engine,
        signal,
        "source-or-destination",
      );
      if (torrent.status !== "stopped")
        await engine.pause(download.hash, signal);
      await verifyTorrent(download, engine, signal, "source-or-destination");
      if ((await realpath(torrent.downloadDirectory)) !== download.destination)
        await engine.setLocation(download.hash, download.destination, signal);
      await verifyTorrent(download, engine, signal, "destination");
    }
    await verifyTorrents(transfer, input, "destination");
    await heartbeat();
    signal.throwIfAborted();
    database.sqlite.transaction(() => {
      for (const file of transfer.libraryFiles) {
        const updated = database.sqlite
          .query(
            "UPDATE library_files SET path = ?, strategy = ?, updated_at = ? WHERE id = ? AND path = ?",
          )
          .run(
            file.destination,
            file.strategy,
            Date.now(),
            file.id,
            file.source,
          );
        if (updated.changes !== 1)
          throw new Error("Library record changed while organizing volumes");
      }
      for (const download of transfer.downloads) {
        const updated = database.sqlite
          .query(`UPDATE downloads SET download_directory = ?, download_path = ?, updated_at = ?
          WHERE id = ? AND COALESCE(download_directory, download_path) = ?`)
          .run(
            download.destination,
            download.destination,
            Date.now(),
            download.id,
            download.recordedSource,
          );
        if (updated.changes !== 1)
          throw new Error("Download record changed while organizing volumes");
      }
      transfer.stage = "committed";
      saveVolumeTransfer(database, transfer);
    })();
    await heartbeat();
  }
  if (transfer.stage === "committed") {
    await verifyTorrents(transfer, input, "destination");
    for (const download of transfer.downloads) {
      signal.throwIfAborted();
      if (download.hash === null || download.source === download.destination)
        continue;
      const engine = await input.transmission();
      const torrent = await verifyTorrent(
        download,
        engine,
        signal,
        "destination",
      );
      if (download.running && torrent.status === "stopped")
        await engine.start(download.hash, signal);
    }
    for (const file of transfer.files) {
      signal.throwIfAborted();
      await heartbeat();
      if (file.source === file.destination) continue;
      await verifyDestination(file, signal);
      if (await lstatOrMissing(file.source)) {
        await assertSource(file);
        if (await sameEntry(file.source, file.destination))
          throw new Error(
            "Source and destination resolve to the same directory entry",
          );
        await unlink(file.source);
      }
    }
    for (const file of transfer.files) {
      if (file.source !== file.destination)
        await removeEmptyParents(dirname(file.source), file.sourceRoot);
    }
    for (const file of transfer.files) {
      const staged = file.stagingPath;
      const info = await lstatOrMissing(staged);
      if (!info) continue;
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        !file.stagingIdentity ||
        info.dev !== file.stagingIdentity.dev ||
        info.ino !== file.stagingIdentity.ino
      )
        throw new Error("Transfer staging file was replaced before cleanup");
      await unlink(staged);
    }
    for (const root of new Set(
      transfer.files.map((file) => dirname(file.stagingPath)),
    ))
      await rmdir(root).catch(ignoreMissing);
    transfer.stage = "complete";
    saveVolumeTransfer(database, transfer);
  }
}

async function prepareStaging(transfer: VolumeTransfer): Promise<void> {
  for (const file of transfer.files)
    await ensureDirectory(file.destinationRoot, dirname(file.stagingPath));
}

async function verifyCapacity(
  transfer: VolumeTransfer,
  options: TransferStorageOptions,
): Promise<void> {
  const measure = options.measureFreeBytes ?? measureFreeBytes;
  const deviceForPath = options.deviceForPath ?? filesystemDevice;
  const devices = new Map<
    number,
    { available: bigint; required: bigint; roots: string[] }
  >();
  const rootDevices = new Map<string, number>();
  for (const root of new Set(
    transfer.files.map((file) => file.destinationRoot),
  )) {
    const device = await deviceForPath(root);
    const available = await measure(root);
    if (available === null)
      throw new Error(`Destination free space could not be measured: ${root}`);
    const existing = devices.get(device);
    if (existing) {
      existing.available =
        existing.available < available ? existing.available : available;
      existing.roots.push(root);
    } else devices.set(device, { available, required: 0n, roots: [root] });
    rootDevices.set(root, device);
  }
  for (const file of transfer.files) {
    if (file.kind !== "copy" || file.source === file.destination) continue;
    const device = rootDevices.get(file.destinationRoot);
    const capacity = device === undefined ? undefined : devices.get(device);
    if (!capacity)
      throw new Error("Destination filesystem could not be measured");
    const staged = await lstatOrMissing(file.stagingPath);
    if (
      staged &&
      (!staged.isFile() ||
        staged.isSymbolicLink() ||
        !file.stagingIdentity ||
        staged.dev !== file.stagingIdentity.dev ||
        staged.ino !== file.stagingIdentity.ino)
    )
      throw new Error("Transfer staging file was replaced");
    const remaining = BigInt(file.identity.size) - BigInt(staged?.size ?? 0);
    if (remaining > 0n) capacity.required += remaining;
  }
  for (const capacity of devices.values()) {
    if (capacity.available - capacity.required < STORAGE_RESERVE_BYTES)
      throw new Error(
        `Not enough free space to organize files while retaining the storage reserve: ${capacity.roots.join(", ")}`,
      );
  }
}

async function verifyTorrents(
  transfer: VolumeTransfer,
  input: {
    transmission: () => Promise<TorrentEngine>;
    signal: AbortSignal;
    heartbeat: () => Promise<void>;
  },
  location: "source-or-destination" | "destination",
): Promise<void> {
  for (const download of transfer.downloads) {
    input.signal.throwIfAborted();
    await input.heartbeat();
    if (download.hash !== null)
      await verifyTorrent(
        download,
        await input.transmission(),
        input.signal,
        location,
      );
  }
}

async function verifyTorrent(
  download: TransferDownload,
  engine: TorrentEngine,
  signal: AbortSignal,
  location: "source-or-destination" | "destination",
): Promise<TorrentSnapshot> {
  if (download.hash === null) throw new Error("Torrent identity is missing");
  const torrent = await engine.get(download.hash, signal);
  if (
    !torrent ||
    download.label === null ||
    !isOwnedTorrentIdentity(
      {
        id: download.id,
        engineLabel: download.label,
        engineInfoHash: download.hash,
        expectedInfoHash: null,
      },
      torrent,
    )
  )
    throw new Error(
      "Torrent location changed or ownership could not be verified",
    );
  const currentDirectory = await realpath(torrent.downloadDirectory);
  if (
    currentDirectory !== download.destination &&
    (location === "destination" || currentDirectory !== download.source)
  )
    throw new Error("Torrent location changed while organizing volumes");
  const expected = fileSignature(download.files);
  if (fileSignature(torrent.files) !== expected)
    throw new Error("Torrent selected files changed while organizing volumes");
  if (
    torrent.progress < 1 ||
    torrent.files.some(
      (file) => file.wanted && file.bytesCompleted < file.length,
    )
  )
    throw new Error("A linked torrent is no longer complete");
  return torrent;
}

function fileSignature(
  files: readonly {
    index: number;
    name: string;
    length: number;
    wanted: boolean;
  }[],
): string {
  return JSON.stringify(
    files
      .map((file) => ({
        index: file.index,
        name: file.name,
        length: file.length,
        wanted: file.wanted,
      }))
      .sort((left, right) => left.index - right.index),
  );
}

async function ensureDirectory(root: string, directory: string): Promise<void> {
  if (!isPathContained(root, directory))
    throw new Error("Destination directory escapes its storage root");
  await validateDirectory(root, root);
  let current = resolve(root);
  for (const segment of relative(root, directory).split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      )
        throw error;
    }
    await validateDirectory(root, current);
  }
}

async function publishFile(
  file: TransferFile,
  signal: AbortSignal,
): Promise<void> {
  await ensureDirectory(file.destinationRoot, dirname(file.destination));
  if (file.source === file.destination) {
    if (file.kind !== "copy") {
      const alreadyPublished = await verifyDestination(file, signal).then(
        () => true,
        () => false,
      );
      if (!alreadyPublished) {
        await assertSource(file);
        const temporary = `${file.stagingPath}.link`;
        const existing = await lstatOrMissing(temporary);
        if (existing) {
          if (file.kind === "symlink") {
            if (
              !existing.isSymbolicLink() ||
              resolve(dirname(file.destination), await readlink(temporary)) !==
                file.target
            )
              throw new Error("Staging link was replaced");
          } else {
            if (!file.target) throw new Error("Hardlink target is missing");
            const targetInfo = await lstat(file.target);
            if (
              !existing.isFile() ||
              existing.dev !== targetInfo.dev ||
              existing.ino !== targetInfo.ino
            )
              throw new Error("Staging link was replaced");
          }
        } else if (file.kind === "symlink") {
          if (!file.target) throw new Error("Symlink target is missing");
          await symlink(
            relative(dirname(file.destination), file.target),
            temporary,
            "file",
          );
        } else {
          if (!file.target) throw new Error("Hardlink target is missing");
          await link(file.target, temporary);
        }
        await rename(temporary, file.destination);
      }
    }
    await verifyDestination(file, signal);
    return;
  }
  if (await lstatOrMissing(file.destination)) {
    await verifyDestination(file, signal);
    return;
  }
  if (file.kind === "symlink") {
    if (!file.target) throw new Error("Symlink target is missing");
    await symlink(
      relative(dirname(file.destination), file.target),
      file.destination,
      "file",
    );
  } else if (file.kind === "hardlink") {
    if (!file.target) throw new Error("Hardlink target is missing");
    await link(file.target, file.destination);
  } else {
    await link(file.stagingPath, file.destination);
  }
  await verifyDestination(file, signal);
}

async function verifyDestination(
  file: TransferFile,
  signal: AbortSignal,
): Promise<void> {
  await validateDirectory(file.destinationRoot, dirname(file.destination));
  const info = await lstatOrMissing(file.destination);
  if (file.kind === "symlink") {
    if (
      !info?.isSymbolicLink() ||
      resolve(dirname(file.destination), await readlink(file.destination)) !==
        file.target
    )
      throw new Error(`Library destination collision: ${file.destination}`);
    return;
  }
  if (
    !info?.isFile() ||
    info.isSymbolicLink() ||
    file.checksum === null ||
    !(await matchesChecksum(file.destination, file.checksum, signal))
  )
    throw new Error(
      `Library destination collision or verification failure: ${file.destination}`,
    );
  if (file.kind === "hardlink" && file.target) {
    const target = await lstat(file.target);
    if (info.dev !== target.dev || info.ino !== target.ino)
      throw new Error(
        `Destination file is not linked to its torrent payload: ${file.destination}`,
      );
  }
}

async function assertSource(file: TransferFile): Promise<void> {
  await validateDirectory(file.sourceRoot, dirname(file.source));
  const info = await lstat(file.source);
  const current: FileIdentity = {
    dev: info.dev,
    ino: info.ino,
    size: info.size,
    mtimeMs: info.mtimeMs,
    link: info.isSymbolicLink() ? await readlink(file.source) : null,
  };
  if (
    JSON.stringify(current) !== JSON.stringify(file.identity) ||
    (!info.isFile() && !info.isSymbolicLink())
  )
    throw new Error(`Source changed while organizing volumes: ${file.source}`);
}

async function copyAndHash(
  source: string,
  destination: string,
  signal: AbortSignal,
): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const writer = Bun.file(destination).writer();
  try {
    for await (const chunk of Bun.file(source).stream()) {
      signal.throwIfAborted();
      writer.write(chunk);
      await writer.flush();
      hasher.update(chunk);
    }
  } finally {
    await writer.end();
  }
  return hasher.digest("hex");
}

async function hashFile(path: string, signal: AbortSignal): Promise<string> {
  const hash = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) {
    signal.throwIfAborted();
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function matchesChecksum(
  path: string,
  checksum: string,
  signal: AbortSignal,
): Promise<boolean> {
  const info = await lstatOrMissing(path);
  return (
    info !== null &&
    info.isFile() &&
    !info.isSymbolicLink() &&
    (await hashFile(path, signal)) === checksum
  );
}

async function removeEmptyParents(
  directory: string,
  root: string,
): Promise<void> {
  let current = directory;
  while (current !== resolve(root) && isPathContained(root, current)) {
    try {
      await validateDirectory(root, current);
      await rmdir(current);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["ENOENT", "ENOTEMPTY", "EEXIST"].includes(String(error.code))
      )
        return;
      throw error;
    }
    current = dirname(current);
  }
}

function ignoreMissing(error: unknown): void {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
    throw error;
}
