import type { BackendDatabase } from "./database";

import { z } from "zod";

import { AppError } from "../core";

const FileIdentitySchema = z.object({
  dev: z.number(),
  ino: z.number(),
  size: z.number().nonnegative(),
  mtimeMs: z.number(),
  link: z.string().nullable(),
});

const TransferFileModeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("copy"), target: z.null() }),
  z.object({ kind: z.enum(["hardlink", "symlink"]), target: z.string() }),
]);

const TransferFileSchema = z
  .object({
    source: z.string(),
    sourceRoot: z.string(),
    destination: z.string(),
    destinationRoot: z.string(),
    identity: FileIdentitySchema,
    checksum: z.string().nullable(),
    stagingIdentity: z.object({ dev: z.number(), ino: z.number() }).nullable(),
    stagingPath: z.string(),
    retirementPath: z.string(),
  })
  .and(TransferFileModeSchema);

const TransferDownloadSchema = z.object({
  id: z.string(),
  hash: z.string().nullable(),
  label: z.string().nullable(),
  source: z.string(),
  recordedSource: z.string(),
  destination: z.string(),
  running: z.boolean(),
  files: z.array(
    z.object({
      index: z.number(),
      name: z.string(),
      length: z.number(),
      wanted: z.boolean(),
    }),
  ),
});

export const VolumeTransferSchema = z.object({
  id: z.string(),
  groupKey: z.string(),
  groupKeys: z.array(z.string()),
  jobId: z.string(),
  title: z.string(),
  mediaIds: z.array(z.string()),
  destinationVolumeId: z.string(),
  stagingRoot: z.string(),
  paths: z.array(z.string()),
  files: z.array(TransferFileSchema),
  libraryFiles: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      destination: z.string(),
      strategy: z.enum(["copy", "move", "hardlink", "symlink"]),
    }),
  ),
  downloads: z.array(TransferDownloadSchema),
  stage: z.enum(["copying", "published", "committed", "complete"]),
});

export type VolumeTransfer = z.infer<typeof VolumeTransferSchema>;
export type TransferFile = z.infer<typeof TransferFileSchema>;
export type TransferFileMode = z.infer<typeof TransferFileModeSchema>;
export type TransferDownload = z.infer<typeof TransferDownloadSchema>;
export type FileIdentity = z.infer<typeof FileIdentitySchema>;

export function activeVolumeTransfers(
  database: BackendDatabase,
): VolumeTransfer[] {
  return database.sqlite
    .query<{ manifest_json: string }, []>(
      "SELECT manifest_json FROM volume_transfers WHERE stage <> 'complete' ORDER BY created_at, id",
    )
    .all()
    .map((row) => VolumeTransferSchema.parse(JSON.parse(row.manifest_json)));
}

export function saveVolumeTransfer(
  database: BackendDatabase,
  transfer: VolumeTransfer,
): void {
  database.sqlite
    .query(`
    INSERT INTO volume_transfers (id, group_key, stage, manifest_json, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?5)
    ON CONFLICT(id) DO UPDATE SET stage = excluded.stage,
      manifest_json = excluded.manifest_json, updated_at = excluded.updated_at
  `)
    .run(
      transfer.id,
      transfer.groupKey,
      transfer.stage,
      JSON.stringify(transfer),
      Date.now(),
    );
}

export function hasActiveVolumeTransfer(database: BackendDatabase): boolean {
  return (
    database.sqlite
      .query("SELECT 1 FROM volume_transfers WHERE stage <> 'complete' LIMIT 1")
      .get() !== null
  );
}

export function isMediaTransferring(
  database: BackendDatabase,
  mediaIds: readonly string[],
): boolean {
  const ids = new Set(mediaIds);
  return activeVolumeTransfers(database).some((transfer) =>
    transfer.mediaIds.some((id) => ids.has(id)),
  );
}

export function isDownloadTransferring(
  database: BackendDatabase,
  downloadId: string,
): boolean {
  return activeVolumeTransfers(database).some((transfer) =>
    transfer.downloads.some((download) => download.id === downloadId),
  );
}

export function transferringPaths(
  database: BackendDatabase,
  changedSince?: number,
): readonly string[] {
  const transfers =
    changedSince === undefined
      ? activeVolumeTransfers(database)
      : database.sqlite
          .query<{ manifest_json: string }, [number]>(
            "SELECT manifest_json FROM volume_transfers WHERE stage <> 'complete' OR updated_at >= ?",
          )
          .all(changedSince)
          .map((row) =>
            VolumeTransferSchema.parse(JSON.parse(row.manifest_json)),
          );
  return transfers.flatMap((transfer) => transfer.paths);
}

const mutations = new WeakMap<BackendDatabase, Set<ReadonlySet<string>>>();
const storageMutations = new WeakSet<BackendDatabase>();

export function isMediaMutating(
  database: BackendDatabase,
  mediaIds: readonly string[],
): boolean {
  return (
    storageMutations.has(database) ||
    [...(mutations.get(database) ?? [])].some((reserved) =>
      mediaIds.some((id) => reserved.has(id)),
    )
  );
}

export function isStorageMutating(database: BackendDatabase): boolean {
  return storageMutations.has(database);
}

export async function withMediaMutation<T>(
  database: BackendDatabase,
  mediaIds: readonly string[],
  operation: () => Promise<T>,
): Promise<T> {
  if (
    isMediaTransferring(database, mediaIds) ||
    isMediaMutating(database, mediaIds)
  ) {
    throw volumeConflict();
  }
  const operations = mutations.get(database) ?? new Set<ReadonlySet<string>>();
  const reserved = new Set(mediaIds);
  mutations.set(database, operations);
  operations.add(reserved);
  try {
    return await operation();
  } finally {
    operations.delete(reserved);
    if (operations.size === 0) mutations.delete(database);
  }
}

export async function withStorageMutation<T>(
  database: BackendDatabase,
  operation: () => Promise<T>,
): Promise<T> {
  if (
    hasActiveVolumeTransfer(database) ||
    storageMutations.has(database) ||
    (mutations.get(database)?.size ?? 0) > 0
  ) {
    throw volumeConflict();
  }
  storageMutations.add(database);
  try {
    return await operation();
  } finally {
    storageMutations.delete(database);
  }
}

export class VolumeMutationConflictError extends AppError {
  constructor() {
    super({
      code: "conflict",
      status: 409,
      message:
        "This media is being organized or changed. Try again when the operation finishes.",
    });
  }
}

function volumeConflict(): VolumeMutationConflictError {
  return new VolumeMutationConflictError();
}
