import { realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { isPathContained } from "./paths";

export interface StorageRootAlias {
  configured: string;
  canonical: string;
}

export async function storageRootAliases(
  roots: readonly string[],
): Promise<readonly StorageRootAlias[]> {
  return Promise.all(
    roots.map(async (root) => ({
      configured: resolve(root),
      canonical: await realpath(root).catch(() => resolve(root)),
    })),
  );
}

export function expandStoragePathAliases(
  values: readonly string[],
  roots: readonly StorageRootAlias[],
): readonly string[] {
  return [...new Set(values.flatMap((value) => pathVariants(value, roots)))];
}

export function isWithinStoragePaths(
  value: string,
  expandedPaths: readonly string[],
  roots: readonly StorageRootAlias[],
): boolean {
  return pathVariants(value, roots).some((candidate) =>
    expandedPaths.some((path) => isPathContained(path, candidate)),
  );
}

function pathVariants(
  value: string,
  roots: readonly StorageRootAlias[],
): readonly string[] {
  const path = resolve(value);
  const variants = new Set([path]);
  for (const root of roots) {
    if (isPathContained(root.configured, path)) {
      variants.add(resolve(root.canonical, relative(root.configured, path)));
    }
    if (isPathContained(root.canonical, path)) {
      variants.add(resolve(root.configured, relative(root.canonical, path)));
    }
  }
  return [...variants];
}
