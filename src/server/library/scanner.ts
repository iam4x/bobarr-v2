import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

import { isPathContained } from "./paths";

const DEFAULT_MEDIA_EXTENSIONS = [
  ".mkv",
  ".mp4",
  ".m4v",
  ".avi",
  ".mov",
  ".webm",
  ".ts",
] as const;

export interface LibraryScanOptions {
  root: string;
  extensions?: readonly string[];
  ignoredDirectories?: readonly string[];
  followSymlinks?: boolean;
  maxDepth?: number;
  maxFiles?: number;
}

export interface ScannedLibraryFile {
  absolutePath: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: number;
}

export async function scanLibrary(
  options: LibraryScanOptions,
): Promise<readonly ScannedLibraryFile[]> {
  const root = await realpath(options.root);
  const extensions = new Set(
    (options.extensions ?? DEFAULT_MEDIA_EXTENSIONS).map(normalizeExtension),
  );
  const ignored = new Set(options.ignoredDirectories ?? [".git", "@eaDir"]);
  const maxDepth = options.maxDepth ?? 20;
  const maxFiles = options.maxFiles ?? 100_000;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) {
    throw new TypeError("maxDepth must be a non-negative integer");
  }
  if (!Number.isSafeInteger(maxFiles) || maxFiles <= 0) {
    throw new TypeError("maxFiles must be a positive integer");
  }
  const visitedDirectories = new Set<string>();
  const files: ScannedLibraryFile[] = [];

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const resolvedDirectory = await realpath(directory);
    if (
      !isPathContained(root, resolvedDirectory) ||
      visitedDirectories.has(resolvedDirectory)
    ) {
      return;
    }
    visitedDirectories.add(resolvedDirectory);
    const entries = await readdir(resolvedDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = resolve(resolvedDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) await walk(path, depth + 1);
        continue;
      }
      let filePath = path;
      let fileInfo: Awaited<ReturnType<typeof stat>>;
      if (entry.isSymbolicLink()) {
        if (!options.followSymlinks) continue;
        filePath = await realpath(path);
        if (!isPathContained(root, filePath)) continue;
        fileInfo = await stat(filePath);
        if (fileInfo.isDirectory()) {
          await walk(filePath, depth + 1);
          continue;
        }
      } else {
        const pathInfo = await lstat(path);
        if (!pathInfo.isFile()) continue;
        fileInfo = pathInfo;
      }
      if (!fileInfo.isFile()) continue;
      const extension = extname(entry.name).toLowerCase();
      if (!extensions.has(extension)) continue;
      if (files.length >= maxFiles) {
        throw new Error(`Library scan exceeded ${maxFiles} media files`);
      }
      files.push({
        absolutePath: filePath,
        relativePath: relative(root, path),
        extension,
        sizeBytes: fileInfo.size,
        modifiedAt: fileInfo.mtimeMs,
      });
    }
  }

  await walk(root, 0);
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

function normalizeExtension(value: string): string {
  const extension = value.startsWith(".") ? value : `.${value}`;
  if (!/^\.[a-z\d]{1,10}$/i.test(extension)) {
    throw new TypeError(`Invalid media extension: ${value}`);
  }
  return extension.toLowerCase();
}
