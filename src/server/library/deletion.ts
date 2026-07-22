import { lstat, realpath, unlink } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { isPathContained } from "./paths";

export class UnsafeLibraryDeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeLibraryDeletionError";
  }
}

/**
 * Delete a recorded file without following a symlinked parent outside a
 * configured library root. Symbolic-link files themselves remain valid
 * records and are unlinked without following their target.
 */
export async function deleteRecordedFile(
  filePath: string,
  configuredRoots: readonly string[],
): Promise<boolean> {
  const candidate = resolve(filePath);
  let canonicalRoot: string | undefined;
  let traversalRoot: string | undefined;
  for (const configuredRoot of configuredRoots) {
    const lexicalRoot = resolve(configuredRoot);
    const lexicalMatch = isPathContained(lexicalRoot, candidate);
    const resolvedRoot = await realpath(lexicalRoot).catch(() => undefined);
    if (!resolvedRoot) {
      if (lexicalMatch) {
        throw new UnsafeLibraryDeletionError(
          "Configured library root does not exist",
        );
      }
      continue;
    }
    if (lexicalMatch) {
      canonicalRoot = resolvedRoot;
      traversalRoot = lexicalRoot;
      break;
    }
    if (isPathContained(resolvedRoot, candidate)) {
      canonicalRoot = resolvedRoot;
      traversalRoot = resolvedRoot;
      break;
    }
  }
  if (!canonicalRoot || !traversalRoot) {
    throw new UnsafeLibraryDeletionError(
      "Recorded library path escapes the configured roots",
    );
  }

  const parent = dirname(candidate);
  const relativeParent = relative(traversalRoot, parent);
  let current = traversalRoot;
  for (const segment of relativeParent.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    const info = await lstat(current).catch((error: unknown) => {
      if (isErrno(error, "ENOENT")) return null;
      throw error;
    });
    if (!info) return false;
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new UnsafeLibraryDeletionError(
        "Recorded library path contains an unsafe parent component",
      );
    }
  }

  const resolvedParent = await realpath(parent).catch((error: unknown) => {
    if (isErrno(error, "ENOENT")) return null;
    throw error;
  });
  if (!resolvedParent) return false;
  if (!isPathContained(canonicalRoot, resolvedParent)) {
    throw new UnsafeLibraryDeletionError(
      "Recorded library path resolves outside the configured roots",
    );
  }

  const info = await lstat(filePath).catch((error: unknown) => {
    if (isErrno(error, "ENOENT")) return null;
    throw error;
  });
  if (!info) return false;
  if (info.isDirectory()) {
    throw new UnsafeLibraryDeletionError("Recorded library path is not a file");
  }
  await unlink(filePath);
  return true;
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
