import {
  constants,
  copyFile,
  link,
  lstat,
  mkdir,
  readlink,
  realpath,
  rename,
  symlink,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { isPathContained, resolveContainedPath } from "./paths";

export type OrganizationMode = "hardlink" | "symlink" | "copy" | "move";
export type CollisionPolicy = "error" | "skip" | "replace";

export interface OrganizeFileRequest {
  sourceRoot: string;
  libraryRoot: string;
  sourcePath: string;
  relativeDestination: string;
  mode: OrganizationMode;
  collision?: CollisionPolicy;
  fallbackToCopy?: boolean;
}

export interface OrganizeFileResult {
  source: string;
  destination: string;
  requestedMode: OrganizationMode;
  actualMode: OrganizationMode;
  created: boolean;
}

export class UnsafeLibraryPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeLibraryPathError";
  }
}

export async function organizeFile(
  request: OrganizeFileRequest,
): Promise<OrganizeFileResult> {
  const sourceRoot = await realpath(request.sourceRoot);
  await mkdir(request.libraryRoot, { recursive: true });
  const libraryRoot = await realpath(request.libraryRoot);
  const sourceCandidate = isAbsolute(request.sourcePath)
    ? resolve(request.sourcePath)
    : resolve(sourceRoot, request.sourcePath);
  if (!isPathContained(sourceRoot, sourceCandidate)) {
    throw new UnsafeLibraryPathError("Source file escapes the download root");
  }
  const sourceInfo = await lstatOrNull(sourceCandidate);
  if (sourceInfo && (sourceInfo.isSymbolicLink() || !sourceInfo.isFile())) {
    throw new UnsafeLibraryPathError(
      "Source must be a regular, non-symlink file",
    );
  }
  let source = sourceCandidate;
  if (sourceInfo) {
    source = await realpath(sourceCandidate);
    if (!isPathContained(sourceRoot, source)) {
      throw new UnsafeLibraryPathError(
        "Resolved source file escapes the download root",
      );
    }
  } else {
    await validateMissingSourceParent(sourceRoot, sourceCandidate);
  }

  let destination: string;
  try {
    destination = resolveContainedPath(
      libraryRoot,
      request.relativeDestination,
    );
  } catch (error) {
    throw new UnsafeLibraryPathError(
      error instanceof Error ? error.message : "Unsafe library destination",
    );
  }
  const parent = dirname(destination);
  await ensureContainedDirectory(libraryRoot, parent);

  const destinationInfo = await lstatOrNull(destination);
  if (!sourceInfo) {
    if (
      request.mode === "move" &&
      destinationInfo?.isFile() &&
      !destinationInfo.isSymbolicLink()
    ) {
      return {
        source,
        destination,
        requestedMode: request.mode,
        actualMode: request.mode,
        created: false,
      };
    }
    throw new Error(`Source file does not exist: ${source}`);
  }
  if (destinationInfo) {
    const existingMode = await existingOrganizationMode(
      source,
      destination,
      request,
    );
    if (existingMode) {
      if (request.mode === "move") await unlink(source);
      return {
        source,
        destination,
        requestedMode: request.mode,
        actualMode: existingMode,
        created: false,
      };
    }
    if ((request.collision ?? "error") === "skip") {
      return {
        source,
        destination,
        requestedMode: request.mode,
        actualMode: request.mode,
        created: false,
      };
    }
    if (request.collision === "replace") {
      return replaceOrganizedFile(source, destination, request);
    }
    throw new Error(`Library destination already exists: ${destination}`);
  }

  let actualMode = request.mode;
  if (request.mode === "hardlink") {
    try {
      await link(source, destination);
    } catch (error) {
      if (!request.fallbackToCopy || !isCrossDeviceError(error)) throw error;
      await publishCopy(source, destination);
      actualMode = "copy";
    }
  } else if (request.mode === "symlink") {
    const relativeTarget = relative(parent, source) || source;
    await symlink(relativeTarget, destination, "file");
  } else if (request.mode === "copy") {
    await publishCopy(source, destination);
  } else {
    try {
      await link(source, destination);
      await unlink(source);
    } catch (error) {
      if (!isCrossDeviceError(error)) throw error;
      await publishCopy(source, destination);
      try {
        await unlink(source);
      } catch (unlinkError) {
        await unlink(destination).catch(() => undefined);
        throw unlinkError;
      }
    }
  }

  return {
    source,
    destination,
    requestedMode: request.mode,
    actualMode,
    created: true,
  };
}

async function replaceOrganizedFile(
  source: string,
  destination: string,
  request: OrganizeFileRequest,
): Promise<OrganizeFileResult> {
  const temporary = `${destination}.bobarr-${crypto.randomUUID()}.tmp`;
  let actualMode = request.mode;
  try {
    if (request.mode === "hardlink" || request.mode === "move") {
      try {
        await link(source, temporary);
      } catch (error) {
        if (
          request.mode === "hardlink" &&
          (!request.fallbackToCopy || !isCrossDeviceError(error))
        ) {
          throw error;
        }
        if (!isCrossDeviceError(error)) throw error;
        await copyFile(source, temporary, constants.COPYFILE_EXCL);
        if (request.mode === "hardlink") actualMode = "copy";
      }
    } else if (request.mode === "symlink") {
      const relativeTarget = relative(dirname(destination), source) || source;
      await symlink(relativeTarget, temporary, "file");
    } else {
      await copyFile(source, temporary, constants.COPYFILE_EXCL);
    }

    // Renaming a fully-published sibling over the old regular file or symlink
    // makes replacement atomic for readers and leaves the old file untouched
    // when publication fails.
    await rename(temporary, destination);
    if (request.mode === "move") await unlink(source);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }

  return {
    source,
    destination,
    requestedMode: request.mode,
    actualMode,
    created: true,
  };
}

async function validateMissingSourceParent(
  sourceRoot: string,
  source: string,
): Promise<void> {
  let existingAncestor = dirname(source);
  while (!(await lstatOrNull(existingAncestor))) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) {
      throw new UnsafeLibraryPathError(
        "Could not validate the missing source path",
      );
    }
    existingAncestor = parent;
  }
  const resolvedAncestor = await realpath(existingAncestor);
  if (!isPathContained(sourceRoot, resolvedAncestor)) {
    throw new UnsafeLibraryPathError(
      "Resolved source parent escapes the download root",
    );
  }
}

async function ensureContainedDirectory(
  libraryRoot: string,
  directory: string,
): Promise<void> {
  const relativeDirectory = relative(libraryRoot, directory);
  let current = libraryRoot;
  for (const segment of relativeDirectory.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
    }
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new UnsafeLibraryPathError(
        "Destination path contains a symlink or non-directory component",
      );
    }
    const resolved = await realpath(current);
    if (!isPathContained(libraryRoot, resolved)) {
      throw new UnsafeLibraryPathError(
        "Destination parent escapes the library root",
      );
    }
  }
}

async function publishCopy(source: string, destination: string): Promise<void> {
  const temporary = `${destination}.bobarr-${crypto.randomUUID()}.tmp`;
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    await link(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function existingOrganizationMode(
  source: string,
  destination: string,
  request: OrganizeFileRequest,
): Promise<OrganizationMode | null> {
  const sourceInfo = await lstat(source);
  const destinationInfo = await lstat(destination);
  if (request.mode === "symlink" && destinationInfo.isSymbolicLink()) {
    const target = await readlink(destination);
    return resolve(dirname(destination), target) === source ? "symlink" : null;
  }
  if (
    destinationInfo.isFile() &&
    sourceInfo.dev === destinationInfo.dev &&
    sourceInfo.ino === destinationInfo.ino
  ) {
    return request.mode;
  }
  if (
    !destinationInfo.isFile() ||
    (request.mode !== "copy" &&
      request.mode !== "move" &&
      !(request.mode === "hardlink" && request.fallbackToCopy))
  ) {
    return null;
  }
  if (!(await filesHaveSameContents(source, destination))) return null;
  return request.mode === "hardlink" ? "copy" : request.mode;
}

async function filesHaveSameContents(
  source: string,
  destination: string,
): Promise<boolean> {
  const [sourceInfo, destinationInfo] = await Promise.all([
    lstat(source),
    lstat(destination),
  ]);
  if (
    !sourceInfo.isFile() ||
    !destinationInfo.isFile() ||
    sourceInfo.size !== destinationInfo.size
  ) {
    return false;
  }
  const [sourceHash, destinationHash] = await Promise.all([
    hashFile(source),
    hashFile(destination),
  ]);
  return sourceHash === destinationHash;
}

async function hashFile(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

async function lstatOrNull(
  path: string,
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return null;
    throw error;
  }
}

function isCrossDeviceError(error: unknown): boolean {
  return isErrno(error, "EXDEV");
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
