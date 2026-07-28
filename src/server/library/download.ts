import { realpath, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { isPathContained } from "./paths";

export interface ReadableRecordedFile {
  path: string;
  name: string;
  sizeBytes: number;
}

/**
 * Resolve a recorded library file without allowing the database record or a
 * replaced symlink to escape the configured media directories.
 */
export async function resolveRecordedFileForRead(
  filePath: string,
  libraryRoots: readonly string[],
  readableRoots: readonly string[] = libraryRoots,
): Promise<ReadableRecordedFile | null> {
  const candidate = resolve(filePath);
  const canonicalLibraryRoots = await canonicalRoots(libraryRoots);
  const belongsToLibrary = libraryRoots.some((root) =>
    isPathContained(resolve(root), candidate),
  );
  const belongsToCanonicalLibrary = canonicalLibraryRoots.some((root) =>
    isPathContained(root, candidate),
  );
  if (!belongsToLibrary && !belongsToCanonicalLibrary) return null;

  const resolvedPath = await realpath(candidate).catch(() => null);
  if (!resolvedPath) return null;

  const canonicalReadableRoots = await canonicalRoots(readableRoots);
  if (
    !canonicalReadableRoots.some((root) => isPathContained(root, resolvedPath))
  ) {
    return null;
  }

  const info = await stat(resolvedPath).catch(() => null);
  if (!info?.isFile()) return null;

  return {
    path: resolvedPath,
    name: basename(candidate),
    sizeBytes: info.size,
  };
}

async function canonicalRoots(roots: readonly string[]): Promise<string[]> {
  return (
    await Promise.all(
      roots.map((root) => realpath(resolve(root)).catch(() => null)),
    )
  ).filter((root): root is string => root !== null);
}
