import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";

import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readlink,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";

import { isPathContained } from "./paths";

export type FileEntryIdentity = Pick<Stats, "dev" | "ino" | "size" | "mtimeMs">;
export interface VerifiedFileHooks {
  afterCopy?: () => Promise<void>;
  beforeSourceCapture?: () => Promise<void>;
  beforeSourceRemoval?: () => Promise<void>;
  beforeSync?: (path: string) => Promise<void>;
}
type OperationOptions = { signal?: AbortSignal; hooks?: VerifiedFileHooks };
export type RetainedSource = {
  source: string;
  retirementPath: string;
  destination: string;
  checksum?: string;
  expectedSource?: FileEntryIdentity;
} & (
  | { kind: "file" }
  | { kind: "symlink"; linkText: string; payloadSource: string }
);

type OpenedFile = { path: string; handle: FileHandle; identity: Stats };

export async function copyVerifiedFile(
  input: {
    source: string;
    destination: string;
    destinationIdentity?: Pick<Stats, "dev" | "ino">;
  } & OperationOptions,
): Promise<string> {
  const source = await openRegular(input.source);
  let destination: FileHandle | undefined;
  try {
    const path = await canonicalEntry(input.destination);
    destination = await open(
      path,
      constants.O_RDWR |
        constants.O_NOFOLLOW |
        (input.destinationIdentity ? 0 : constants.O_CREAT | constants.O_EXCL),
      source.identity.mode & 0o777,
    );
    const identity = await destination.stat();
    if (
      !identity.isFile() ||
      sameInode(identity, source.identity) ||
      (input.destinationIdentity &&
        !sameInode(identity, input.destinationIdentity))
    )
      throw new Error("Copy destination is not an owned independent file");
    await destination.truncate(0);
    const buffer = Buffer.allocUnsafe(256 * 1024);
    const hash = new Bun.CryptoHasher("sha256");
    let position = 0;
    while (true) {
      input.signal?.throwIfAborted();
      const { bytesRead } = await source.handle.read(
        buffer,
        0,
        buffer.length,
        position,
      );
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const result = await destination.write(
          buffer,
          written,
          bytesRead - written,
          position + written,
        );
        if (result.bytesWritten === 0)
          throw new Error("Copy made no write progress");
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    await input.hooks?.afterCopy?.();
    const checksum = hash.digest("hex");
    await syncHandle(destination, path, input.hooks);
    if ((await hashHandle(destination, input.signal)) !== checksum)
      throw new Error("Copied file failed content verification");
    await assertStable(source);
    await assertEntry(path, await destination.stat());
    await syncDirectoryAndParents(dirname(path), input.hooks);
    return checksum;
  } finally {
    await destination?.close();
    await source.handle.close();
  }
}

export async function assertMatchingContents(
  input: {
    source: string;
    destination: string;
    checksum?: string;
  } & OperationOptions,
): Promise<string> {
  return (await verifyPair(input, false)).checksum;
}

export async function syncFileAndParents(
  path: string,
  hooks?: VerifiedFileHooks,
): Promise<void> {
  const file = await openRegular(path);
  try {
    await syncHandle(file.handle, file.path, hooks);
    await syncDirectoryAndParents(dirname(file.path), hooks);
    await assertEntry(file.path, file.identity);
  } finally {
    await file.handle.close();
  }
}

export async function retireVerifiedSource(
  input: RetainedSource & OperationOptions,
): Promise<void> {
  input.signal?.throwIfAborted();
  const retirement = await retirementEntry(input.retirementPath, input.source);
  const retained = await missingOrStat(retirement);
  if (retained) {
    await verifyRetained(input, retirement, input.expectedSource);
    return;
  }
  const source = await canonicalEntry(input.source);
  const destination = await canonicalEntry(input.destination);
  if (
    source === destination ||
    source === retirement ||
    destination === retirement
  )
    throw new Error(
      "Source, destination and retirement must be separate entries",
    );
  const identity = await verifyRetained(input, source, input.expectedSource);
  const parent = await lstat(dirname(retirement));
  await input.hooks?.beforeSourceCapture?.();
  input.signal?.throwIfAborted();
  await assertEntry(dirname(retirement), parent);
  if (await missingOrStat(retirement))
    throw new Error(`Retirement path already contains data: ${retirement}`);
  await rename(source, retirement);
  try {
    await syncDirectoryAndParents(dirname(retirement), input.hooks);
    await syncDirectoryAndParents(dirname(source), input.hooks);
    await verifyRetained(input, retirement, identity);
  } catch (error) {
    throw new Error(
      `Captured source was retained for recovery at ${retirement}`,
      { cause: error },
    );
  }
}

export async function removeVerifiedSource(
  input: RetainedSource & OperationOptions,
): Promise<void> {
  const retirement = await retirementEntry(input.retirementPath, input.source);
  if (
    !(await missingOrStat(retirement)) &&
    !(await missingOrStat(input.source))
  ) {
    await verifyDestination(input);
    return;
  }
  await retireVerifiedSource(input);
  const identity = await verifyRetained(
    input,
    retirement,
    input.expectedSource,
  );
  const parent = await lstat(dirname(retirement));
  await input.hooks?.beforeSourceRemoval?.();
  input.signal?.throwIfAborted();
  await verifyRetained(input, retirement, identity);
  await assertEntry(dirname(retirement), parent);
  await assertEntry(retirement, identity);
  await unlink(retirement);
  await syncDirectoryAndParents(dirname(retirement), input.hooks);
}

async function verifyRetained(
  input: RetainedSource & OperationOptions,
  path: string,
  expected: FileEntryIdentity | undefined,
): Promise<Stats> {
  if (input.kind === "file") {
    const result = await verifyPair({ ...input, source: path }, true, expected);
    return result.identity;
  }
  const identity = await lstat(path);
  if (
    !identity.isSymbolicLink() ||
    (expected && !sameIdentity(identity, expected)) ||
    (await readlink(path)) !== input.linkText
  )
    throw new Error(`Source symlink changed: ${path}`);
  if (await missingOrStat(input.payloadSource))
    await verifyPair({ ...input, source: input.payloadSource }, true);
  else if (path !== (await canonicalEntry(input.source)) && input.checksum)
    await verifyDestination(input);
  else
    throw new Error(
      `Source symlink payload is unavailable: ${input.payloadSource}`,
    );
  await assertEntry(path, identity);
  if ((await readlink(path)) !== input.linkText)
    throw new Error(`Source symlink changed: ${path}`);
  return identity;
}

async function verifyDestination(
  input: RetainedSource & OperationOptions,
): Promise<void> {
  const file = await openRegular(input.destination);
  try {
    const checksum = await hashHandle(file.handle, input.signal);
    if (input.checksum && checksum !== input.checksum)
      throw new Error(`Destination content changed: ${file.path}`);
    await assertStable(file);
    await syncHandle(file.handle, file.path, input.hooks);
    await syncDirectoryAndParents(dirname(file.path), input.hooks);
    await assertEntry(file.path, file.identity);
  } finally {
    await file.handle.close();
  }
}

async function verifyPair(
  input: {
    source: string;
    destination: string;
    checksum?: string;
  } & OperationOptions,
  durable: boolean,
  expected?: FileEntryIdentity,
): Promise<{ checksum: string; identity: Stats }> {
  const source = await openRegular(input.source, expected);
  let destination: OpenedFile | undefined;
  try {
    destination = await openRegular(input.destination);
    const [sourceHash, destinationHash] = await Promise.all([
      hashHandle(source.handle, input.signal),
      hashHandle(destination.handle, input.signal),
    ]);
    if (
      sourceHash !== destinationHash ||
      (input.checksum && sourceHash !== input.checksum)
    )
      throw new Error(
        `Source and destination contents do not match: ${source.path}`,
      );
    await assertStable(source);
    await assertStable(destination);
    if (durable) {
      await syncHandle(destination.handle, destination.path, input.hooks);
      await syncDirectoryAndParents(dirname(destination.path), input.hooks);
    }
    await assertEntry(source.path, source.identity);
    await assertEntry(destination.path, destination.identity);
    return { checksum: sourceHash, identity: source.identity };
  } finally {
    await destination?.handle.close();
    await source.handle.close();
  }
}

async function openRegular(
  path: string,
  expected?: FileEntryIdentity,
): Promise<OpenedFile> {
  const canonical = await canonicalEntry(path);
  const handle = await open(
    canonical,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const identity = await handle.stat();
    if (!identity.isFile() || (expected && !sameIdentity(identity, expected)))
      throw new Error(`Source file changed or is not regular: ${path}`);
    return { path: canonical, handle, identity };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function hashHandle(
  handle: FileHandle,
  signal?: AbortSignal,
): Promise<string> {
  const before = await handle.stat();
  const hash = new Bun.CryptoHasher("sha256");
  const buffer = Buffer.allocUnsafe(256 * 1024);
  let position = 0;
  while (true) {
    signal?.throwIfAborted();
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  const after = await handle.stat();
  if (!sameIdentity(before, after) || before.ctimeMs !== after.ctimeMs)
    throw new Error("File changed during content verification");
  return hash.digest("hex");
}

async function assertStable(file: OpenedFile): Promise<void> {
  const current = await file.handle.stat();
  if (
    !sameIdentity(current, file.identity) ||
    current.ctimeMs !== file.identity.ctimeMs
  )
    throw new Error(`File changed during content verification: ${file.path}`);
}

function sameInode(
  left: Pick<Stats, "dev" | "ino">,
  right: Pick<Stats, "dev" | "ino">,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
function sameIdentity(
  left: FileEntryIdentity,
  right: FileEntryIdentity,
): boolean {
  return (
    sameInode(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}
async function assertEntry(
  path: string,
  identity: FileEntryIdentity,
): Promise<void> {
  if (!sameIdentity(await lstat(path), identity))
    throw new Error(`File entry changed: ${path}`);
}
async function canonicalEntry(path: string): Promise<string> {
  return resolve(await realpath(dirname(path)), basename(path));
}
async function missingOrStat(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}
async function retirementEntry(path: string, source: string): Promise<string> {
  const parent = dirname(resolve(path));
  let boundary = dirname(resolve(source));
  while (!isPathContained(boundary, parent)) boundary = dirname(boundary);
  let current = await realpath(boundary);
  for (const segment of relative(boundary, parent).split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      )
        throw error;
    }
    const directory = await lstat(current);
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new Error("Unsafe retirement directory");
  }
  return resolve(current, basename(path));
}
async function syncHandle(
  handle: FileHandle,
  path: string,
  hooks?: VerifiedFileHooks,
): Promise<void> {
  await hooks?.beforeSync?.(path);
  await handle.sync();
}
export async function syncDirectoryAndParents(
  path: string,
  hooks?: VerifiedFileHooks,
): Promise<void> {
  let current = await realpath(path);
  while (true) {
    const directory = await open(
      current,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await syncHandle(directory, current, hooks);
    } finally {
      await directory.close();
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
