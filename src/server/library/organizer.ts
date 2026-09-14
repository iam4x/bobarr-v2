import type { VerifiedFileHooks } from "./verified-files";
import type { Stats } from "node:fs";

import {
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
import {
  assertMatchingContents,
  copyVerifiedFile,
  removeVerifiedSource,
  syncFileAndParents,
} from "./verified-files";

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

interface OrganizationOptions {
  signal?: AbortSignal;
  hooks?: VerifiedFileHooks;
}

export class UnsafeLibraryPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeLibraryPathError";
  }
}

export async function organizeFile(
  request: OrganizeFileRequest,
  options: OrganizationOptions = {},
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

  if (request.mode === "move") {
    return organizeMove(sourceRoot, source, destination, request, options);
  }

  const destinationInfo = await lstatOrNull(destination);
  if (!sourceInfo) {
    throw new Error(`Source file does not exist: ${source}`);
  }
  if (destinationInfo) {
    const existingMode = await existingOrganizationMode(
      source,
      destination,
      request,
      options,
    );
    if (existingMode) {
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
      return replaceOrganizedFile(source, destination, request, options);
    }
    throw new Error(`Library destination already exists: ${destination}`);
  }

  let actualMode = request.mode;
  if (request.mode === "hardlink") {
    try {
      await link(source, destination);
    } catch (error) {
      if (!request.fallbackToCopy || !isCrossDeviceError(error)) throw error;
      await publishCopy(source, destination, options);
      actualMode = "copy";
    }
  } else if (request.mode === "symlink") {
    const relativeTarget = relative(parent, source) || source;
    await symlink(relativeTarget, destination, "file");
  } else {
    await publishCopy(source, destination, options);
  }

  return {
    source,
    destination,
    requestedMode: request.mode,
    actualMode,
    created: true,
  };
}

async function organizeMove(
  sourceRoot: string,
  source: string,
  destination: string,
  request: OrganizeFileRequest,
  options: OrganizationOptions,
): Promise<OrganizeFileResult> {
  if (source === destination)
    throw new UnsafeLibraryPathError(
      "Source and destination must be separate entries",
    );
  const retirementId = new Bun.CryptoHasher("sha256")
    .update(JSON.stringify([relative(sourceRoot, source), destination]))
    .digest("hex");
  const retirementPath = resolve(
    dirname(source),
    ".bobarr-import-retired",
    `${retirementId}.file`,
  );
  const [sourceInfo, retainedInfo, destinationInfo] = await Promise.all([
    lstatOrNull(source),
    lstatOrNull(retirementPath),
    lstatOrNull(destination),
  ]);
  let created = false;
  if (retainedInfo) {
    await ensureContainedDirectory(sourceRoot, dirname(retirementPath));
    if (sourceInfo)
      throw new Error(
        `A new source appeared during the move; captured data is retained at ${retirementPath}`,
      );
    if (!destinationInfo?.isFile() || destinationInfo.isSymbolicLink())
      throw new Error(
        `The move destination is unavailable; original data is retained at ${retirementPath}`,
      );
    const checksum = await assertMatchingContents({
      source: retirementPath,
      destination,
      ...options,
    });
    await removeVerifiedSource({
      kind: "file",
      source,
      retirementPath,
      destination,
      checksum,
      expectedSource: retainedInfo,
      ...options,
    });
  } else if (!sourceInfo) {
    if (!destinationInfo?.isFile() || destinationInfo.isSymbolicLink())
      throw new Error(`Source file does not exist: ${source}`);
  } else {
    let checksum: string;
    const matching = destinationInfo?.isFile()
      ? await matchingChecksum(source, destination, options)
      : null;
    if (
      destinationInfo &&
      matching &&
      (sourceInfo.dev !== destinationInfo.dev ||
        sourceInfo.ino !== destinationInfo.ino)
    ) {
      checksum = matching;
    } else {
      if (destinationInfo && matching === null) {
        if (request.collision === "skip")
          return {
            source,
            destination,
            requestedMode: "move",
            actualMode: "move",
            created: false,
          };
        if (request.collision !== "replace")
          throw new Error(`Library destination already exists: ${destination}`);
      }
      checksum = await publishCopy(
        source,
        destination,
        options,
        destinationInfo ? "replace" : "create",
      );
      created = true;
    }
    await removeVerifiedSource({
      kind: "file",
      source,
      retirementPath,
      destination,
      checksum,
      expectedSource: sourceInfo,
      ...options,
    });
  }
  if (await lstatOrNull(source))
    throw new Error(
      `A new file appeared at the original source and was preserved: ${source}`,
    );
  return {
    source,
    destination,
    requestedMode: "move",
    actualMode: "move",
    created,
  };
}

async function replaceOrganizedFile(
  source: string,
  destination: string,
  request: OrganizeFileRequest,
  options: OrganizationOptions,
): Promise<OrganizeFileResult> {
  const temporary = `${destination}.bobarr-${crypto.randomUUID()}.tmp`;
  let actualMode = request.mode;
  try {
    if (request.mode === "hardlink") {
      try {
        await link(source, temporary);
      } catch (error) {
        if (!request.fallbackToCopy || !isCrossDeviceError(error)) {
          throw error;
        }
        await copyVerifiedFile({ source, destination: temporary, ...options });
        actualMode = "copy";
      }
    } else if (request.mode === "symlink") {
      const relativeTarget = relative(dirname(destination), source) || source;
      await symlink(relativeTarget, temporary, "file");
    } else {
      await copyVerifiedFile({ source, destination: temporary, ...options });
    }

    // Renaming a fully-published sibling over the old regular file or symlink
    // makes replacement atomic for readers and leaves the old file untouched
    // when publication fails.
    await rename(temporary, destination);
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

async function publishCopy(
  source: string,
  destination: string,
  options: OrganizationOptions,
  publication: "create" | "replace" = "create",
): Promise<string> {
  const temporary = `${destination}.bobarr-${crypto.randomUUID()}.tmp`;
  const checksum = await copyVerifiedFile({
    source,
    destination: temporary,
    ...options,
  });
  if (publication === "replace") await rename(temporary, destination);
  else await link(temporary, destination);
  await syncFileAndParents(destination, options.hooks);
  if (publication === "create") {
    await unlink(temporary);
    await syncFileAndParents(destination, options.hooks);
  }
  return checksum;
}

async function existingOrganizationMode(
  source: string,
  destination: string,
  request: OrganizeFileRequest,
  options: OrganizationOptions,
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
      !(request.mode === "hardlink" && request.fallbackToCopy))
  ) {
    return null;
  }
  if ((await matchingChecksum(source, destination, options)) === null)
    return null;
  return request.mode === "hardlink" ? "copy" : request.mode;
}

async function matchingChecksum(
  source: string,
  destination: string,
  options: OrganizationOptions,
): Promise<string | null> {
  const [sourceInfo, destinationInfo] = await Promise.all([
    lstat(source),
    lstat(destination),
  ]);
  if (
    !sourceInfo.isFile() ||
    !destinationInfo.isFile() ||
    sourceInfo.size !== destinationInfo.size
  ) {
    return null;
  }
  return assertMatchingContents({ source, destination, ...options }).catch(
    () => null,
  );
}

async function lstatOrNull(path: string): Promise<Stats | null> {
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
