import type { StorageVolume } from "../../contracts";
import type { BackendDatabase } from "../db";
import type {
  FileIdentity,
  TransferDownload,
  TransferFile,
  TransferFileMode,
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
  readlink,
  realpath,
  rmdir,
  stat,
  symlink,
} from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";

import { isPathContained } from "./paths";
import {
  assertMatchingContents,
  copyVerifiedFile,
  removeVerifiedSource,
  retireVerifiedSource,
  syncDirectoryAndParents,
  syncFileAndParents,
  type RetainedSource,
} from "./verified-files";
import { lstatOrMissing, validateDirectory } from "./volume-inventory";
import { isOwnedTorrentIdentity } from "../application/torrent-ownership";
import { saveVolumeTransfer } from "../db/volume-transfers";
import { measureFreeBytes, STORAGE_RESERVE_BYTES } from "../storage";

export interface TransferStorageOptions {
  measureFreeBytes?: typeof measureFreeBytes;
  deviceForPath?: (path: string) => Promise<number>;
}

export type TransferProgress =
  | { kind: "stage"; transferId: string; stage: VolumeTransfer["stage"] }
  | ({
      kind: "file";
      transferId: string;
      source: string;
      destination: string;
      bytes: number;
    } & (
      | {
          action:
            | "copy-start"
            | "copy-verified"
            | "published"
            | "destination-verification-start"
            | "destination-verified"
            | "source-reverification-start"
            | "source-removal-start"
            | "source-removed"
            | "staging-cleanup-start"
            | "staging-removed";
        }
      | { action: "source-reverified"; checksum: string }
      | { action: "source-retained"; reason: string }
    ))
  | {
      kind: "copy-progress";
      transferId: string;
      source: string;
      bytesCopied: number;
      totalBytes: number;
    };

export interface TransferRuntimeOptions {
  progress?: (event: TransferProgress) => void;
  retainChangedCommittedSources?: boolean;
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
    let mode: TransferFileMode = { kind: "copy", target: null };
    if (file.identity.link !== null) {
      const target = destinationsBySource.get(await realpath(file.path));
      if (target === undefined)
        throw new Error(
          "A library symlink points to data outside its transfer group",
        );
      mode = { kind: "symlink", target };
    } else if (previous !== undefined && previous !== paths.destination) {
      mode = { kind: "hardlink", target: previous };
    } else primaryByDeviceAndInode.set(inode, paths.destination);
    files.push({
      source: paths.source,
      sourceRoot: paths.sourceRoot,
      destination: paths.destination,
      destinationRoot: paths.destinationRoot,
      identity: file.identity,
      ...mode,
      checksum: null,
      retainedStagingPaths: [],
      stagingPath: resolve(
        paths.destinationRoot,
        ".bobarr-volume-organize",
        id,
        `${index}.file`,
      ),
      retirementPath: resolve(
        paths.sourceRoot,
        ".bobarr-volume-organize",
        id,
        `${index}.source`,
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
    paths.add(dirname(file.retirementPath));
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
  } & TransferStorageOptions &
    TransferRuntimeOptions,
): Promise<void> {
  const { transfer, database, signal, heartbeat } = input;
  if (transfer.stage === "complete") return;
  input.progress?.({
    kind: "stage",
    transferId: transfer.id,
    stage: transfer.stage,
  });
  await pauseTorrents(transfer, input);
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
        input.progress?.({
          kind: "file",
          transferId: transfer.id,
          action: "copy-start",
          source: file.source,
          destination: file.destination,
          bytes: file.identity.size,
        });
        if (file.source === file.destination) {
          file.checksum = await hashFile(file.source, signal);
        } else {
          if (
            file.checksum === null ||
            !(await matchesChecksum(file.stagingPath, file.checksum, signal))
          ) {
            if (await lstatOrMissing(file.stagingPath)) {
              file.retainedStagingPaths.push(file.stagingPath);
              file.stagingPath = resolve(
                dirname(file.stagingPath),
                `${crypto.randomUUID()}.file`,
              );
            }
            file.checksum = null;
            saveVolumeTransfer(database, transfer);
            await verifyCapacity(transfer, input);
            file.checksum = await copyVerifiedFile({
              source: file.source,
              destination: file.stagingPath,
              signal,
              progress: (bytesCopied) =>
                input.progress?.({
                  kind: "copy-progress",
                  transferId: transfer.id,
                  source: file.source,
                  bytesCopied,
                  totalBytes: file.identity.size,
                }),
            });
          }
          await assertMatchingContents({
            source: file.source,
            destination: file.stagingPath,
            checksum: file.checksum,
            signal,
          });
        }
        await assertSource(file);
        saveVolumeTransfer(database, transfer);
        input.progress?.({
          kind: "file",
          transferId: transfer.id,
          action: "copy-verified",
          source: file.source,
          destination: file.destination,
          bytes: file.identity.size,
        });
      }
    }
    for (const file of transfer.files) {
      if (file.kind === "copy") continue;
      const primary = transfer.files.find(
        (candidate) =>
          candidate.destination === file.target && candidate.checksum !== null,
      );
      if (!primary?.checksum)
        throw new Error("A library link has no verified payload");
      file.checksum = primary.checksum;
    }
    saveVolumeTransfer(database, transfer);
    await verifyTorrents(transfer, input, "source-or-destination");
    for (const file of transfer.files) {
      signal.throwIfAborted();
      await heartbeat();
      await publishFile(file, signal);
      input.progress?.({
        kind: "file",
        transferId: transfer.id,
        action: "published",
        source: file.source,
        destination: file.destination,
        bytes: file.identity.size,
      });
    }
    transfer.stage = "published";
    saveVolumeTransfer(database, transfer);
    input.progress?.({
      kind: "stage",
      transferId: transfer.id,
      stage: "published",
    });
    await heartbeat();
  }
  if (transfer.stage === "published") {
    for (const file of transfer.files) {
      signal.throwIfAborted();
      if (file.source !== file.destination) await assertSource(file);
      await verifyDestination(file, signal);
      await syncPublishedFile(file);
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
      saveVolumeTransfer(database, { ...transfer, stage: "committed" });
    })();
    transfer.stage = "committed";
    input.progress?.({
      kind: "stage",
      transferId: transfer.id,
      stage: "committed",
    });
    await heartbeat();
  }
  if (transfer.stage === "committed") {
    await verifyTorrents(transfer, input, "destination");
    const cleanupOrder = [...transfer.files].sort(
      (left, right) =>
        Number(right.kind === "symlink") - Number(left.kind === "symlink"),
    );
    for (const file of cleanupOrder) {
      signal.throwIfAborted();
      await heartbeat();
      if (file.source === file.destination && file.kind === "copy") continue;
      input.progress?.({
        kind: "file",
        transferId: transfer.id,
        action: "destination-verification-start",
        source: file.source,
        destination: file.destination,
        bytes: file.identity.size,
      });
      await verifyDestination(file, signal);
      input.progress?.({
        kind: "file",
        transferId: transfer.id,
        action: "destination-verified",
        source: file.source,
        destination: file.destination,
        bytes: file.identity.size,
      });
      const retained = await lstatOrMissing(file.retirementPath);
      if (file.source === file.destination && !retained) continue;
      if (retained || (await lstatOrMissing(file.source))) {
        const verifiedChecksum = file.checksum;
        if (verifiedChecksum === null)
          throw new Error(
            "An original cannot be removed without a verified copy",
          );
        const currentSource = retained ? file.retirementPath : file.source;
        let sourceIdentityChanged = false;
        try {
          await assertSource(file);
        } catch (error) {
          if (!(error instanceof SourceChangedError)) throw error;
          input.progress?.({
            kind: "file",
            transferId: transfer.id,
            action: "source-reverification-start",
            source: currentSource,
            destination: file.destination,
            bytes: file.identity.size,
          });
          try {
            await assertMatchingChangedSource(file, currentSource, signal);
          } catch (verificationError) {
            await verifyDestination(file, signal);
            if (!input.retainChangedCommittedSources) throw verificationError;
            input.progress?.({
              kind: "file",
              transferId: transfer.id,
              action: "source-retained",
              source: currentSource,
              destination: file.destination,
              bytes: file.identity.size,
              reason:
                verificationError instanceof Error
                  ? verificationError.message
                  : String(verificationError),
            });
            continue;
          }
          sourceIdentityChanged = true;
          input.progress?.({
            kind: "file",
            transferId: transfer.id,
            action: "source-reverified",
            source: currentSource,
            destination: file.destination,
            bytes: file.identity.size,
            checksum: verifiedChecksum,
          });
        }
        if (
          file.source !== file.destination &&
          !retained &&
          (await sameEntry(file.source, file.destination))
        )
          throw new Error(
            "Source and destination resolve to the same directory entry",
          );
        input.progress?.({
          kind: "file",
          transferId: transfer.id,
          action: "source-removal-start",
          source: currentSource,
          destination: file.destination,
          bytes: file.identity.size,
        });
        await removeVerifiedSource({
          ...retainedSource(file),
          expectedSource: sourceIdentityChanged ? undefined : file.identity,
          signal,
        });
        input.progress?.({
          kind: "file",
          transferId: transfer.id,
          action: "source-removed",
          source: file.source,
          destination: file.destination,
          bytes: file.identity.size,
        });
        if (retained && (await lstatOrMissing(file.source)))
          input.progress?.({
            kind: "file",
            transferId: transfer.id,
            action: "source-retained",
            source: file.source,
            destination: file.destination,
            bytes: file.identity.size,
            reason:
              "A new source entry appeared after the original was retired",
          });
      }
    }
    for (const file of transfer.files) {
      if (file.source !== file.destination)
        await removeEmptyParents(dirname(file.source), file.sourceRoot);
    }
    for (const file of transfer.files) {
      if (file.kind !== "copy" || file.source === file.destination) continue;
      const retirementPath = `${file.stagingPath}.source`;
      if (
        !(await lstatOrMissing(file.stagingPath)) &&
        !(await lstatOrMissing(retirementPath))
      )
        continue;
      if (file.checksum === null)
        throw new Error(
          "A staging file cannot be removed without a verified copy",
        );
      input.progress?.({
        kind: "file",
        transferId: transfer.id,
        action: "staging-cleanup-start",
        source: file.stagingPath,
        destination: file.destination,
        bytes: file.identity.size,
      });
      await removeVerifiedSource({
        kind: "file",
        source: file.stagingPath,
        retirementPath,
        destination: file.destination,
        checksum: file.checksum,
        signal,
      });
      input.progress?.({
        kind: "file",
        transferId: transfer.id,
        action: "staging-removed",
        source: file.stagingPath,
        destination: file.destination,
        bytes: file.identity.size,
      });
    }
    for (const root of new Set(
      transfer.files.flatMap((file) => [
        dirname(file.stagingPath),
        dirname(file.retirementPath),
      ]),
    ))
      await removeEmptyParents(root, dirname(root));
    for (const download of transfer.downloads) {
      signal.throwIfAborted();
      if (download.hash === null) continue;
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
    transfer.stage = "complete";
    saveVolumeTransfer(database, transfer);
    input.progress?.({
      kind: "stage",
      transferId: transfer.id,
      stage: "complete",
    });
  }
}

async function pauseTorrents(
  transfer: VolumeTransfer,
  input: {
    transmission: () => Promise<TorrentEngine>;
    signal: AbortSignal;
    heartbeat: () => Promise<void>;
  },
): Promise<void> {
  for (const download of transfer.downloads) {
    input.signal.throwIfAborted();
    await input.heartbeat();
    if (download.hash === null) continue;
    const engine = await input.transmission();
    const location =
      transfer.stage === "committed" ? "destination" : "source-or-destination";
    const torrent = await verifyTorrent(
      download,
      engine,
      input.signal,
      location,
    );
    if (torrent.status !== "stopped")
      await engine.pause(download.hash, input.signal);
    const stopped = await verifyTorrent(
      download,
      engine,
      input.signal,
      location,
    );
    if (stopped.status !== "stopped")
      throw new Error("Torrent did not stop before volume organization");
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
      file.checksum === null ||
      !staged?.isFile() ||
      staged.size !== file.identity.size
    )
      capacity.required += BigInt(file.identity.size);
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
    if (download.hash !== null) {
      const torrent = await verifyTorrent(
        download,
        await input.transmission(),
        input.signal,
        location,
      );
      if (torrent.status !== "stopped")
        throw new Error(
          "Torrent restarted before volume organization finished",
        );
    }
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
        await retireVerifiedSource({ ...retainedSource(file), signal });
        if (file.kind === "symlink") {
          await symlink(
            relative(dirname(file.destination), file.target),
            file.destination,
            "file",
          );
        } else {
          await link(file.target, file.destination);
        }
      }
    }
    await verifyDestination(file, signal);
    await syncPublishedFile(file);
    return;
  }
  if (await lstatOrMissing(file.destination)) {
    await verifyDestination(file, signal);
    return;
  }
  if (file.kind === "symlink") {
    await symlink(
      relative(dirname(file.destination), file.target),
      file.destination,
      "file",
    );
  } else if (file.kind === "hardlink") {
    await link(file.target, file.destination);
  } else {
    await link(file.stagingPath, file.destination);
  }
  await verifyDestination(file, signal);
  await syncPublishedFile(file);
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
        file.target ||
      file.checksum === null ||
      !(await matchesChecksum(file.target, file.checksum, signal))
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
  if (file.kind === "hardlink") {
    const target = await lstat(file.target);
    if (info.dev !== target.dev || info.ino !== target.ino)
      throw new Error(
        `Destination file is not linked to its torrent payload: ${file.destination}`,
      );
  }
}

async function assertSource(file: TransferFile): Promise<void> {
  const source = (await lstatOrMissing(file.retirementPath))
    ? file.retirementPath
    : file.source;
  await validateDirectory(file.sourceRoot, dirname(source));
  const info = await lstat(source);
  const current: FileIdentity = {
    dev: info.dev,
    ino: info.ino,
    size: info.size,
    mtimeMs: info.mtimeMs,
    link: info.isSymbolicLink() ? await readlink(source) : null,
  };
  if (
    JSON.stringify(current) !== JSON.stringify(file.identity) ||
    (!info.isFile() && !info.isSymbolicLink())
  )
    throw new SourceChangedError(file.source, file.identity, current);
}

class SourceChangedError extends Error {
  constructor(source: string, expected: FileIdentity, actual: FileIdentity) {
    super(
      `Source changed while organizing volumes: ${source}; expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`,
    );
    this.name = "SourceChangedError";
  }
}

async function assertMatchingChangedSource(
  file: TransferFile,
  source: string,
  signal: AbortSignal,
): Promise<void> {
  const retained = retainedSource(file);
  if (retained.kind === "file") {
    await assertMatchingContents({
      source,
      destination: retained.destination,
      checksum: retained.checksum,
      signal,
    });
    return;
  }
  const info = await lstat(source);
  if (!info.isSymbolicLink() || (await readlink(source)) !== retained.linkText)
    throw new Error(`Source symlink changed: ${source}`);
  if (await lstatOrMissing(retained.payloadSource))
    await assertMatchingContents({
      source: retained.payloadSource,
      destination: retained.destination,
      checksum: retained.checksum,
      signal,
    });
  else if (source !== file.retirementPath)
    throw new Error(`Source symlink payload is unavailable: ${source}`);
}

function retainedSource(file: TransferFile): RetainedSource {
  if (file.checksum === null)
    throw new Error("An original cannot be removed without a verified copy");
  const common = {
    source: file.source,
    retirementPath: file.retirementPath,
    destination: file.destination,
    checksum: file.checksum,
    expectedSource: file.identity,
  };
  if (file.kind === "symlink") {
    if (file.identity.link === null)
      throw new Error("Symlink payload identity is missing");
    return {
      ...common,
      kind: "symlink",
      destination: file.target,
      linkText: file.identity.link,
      payloadSource: resolve(dirname(file.source), file.identity.link),
    };
  }
  if (file.source === file.destination && file.kind === "hardlink") {
    common.destination = file.target;
  }
  return { ...common, kind: "file" };
}

async function syncPublishedFile(file: TransferFile): Promise<void> {
  const payload = file.kind === "symlink" ? file.target : file.destination;
  await syncFileAndParents(payload);
  if (file.kind === "symlink")
    await syncDirectoryAndParents(dirname(file.destination));
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
