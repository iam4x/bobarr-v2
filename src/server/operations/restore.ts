import { Database } from "bun:sqlite";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createSqliteBackup } from "./backup";
import { verifyMigrationHistory } from "../db/migrations";

export const DEFAULT_RESTORE_MAX_BYTES = 512 * 1024 * 1024;

const STAGING_DIRECTORY = ".restore";
const STAGED_FILENAME = "bobarr-staged.sqlite";
const SQLITE_HEADER = new TextEncoder().encode("SQLite format 3\0");

export interface VerifiedBackup {
  name: string;
  sizeBytes: number;
  createdAt: string;
  migrationVersion: number;
  sha256: string;
  verified: true;
}

export interface StagedRestore {
  sizeBytes: number;
  stagedAt: string;
  migrationVersion: number;
  sha256: string;
  restartRequired: true;
}

export interface AppliedRestore {
  applied: boolean;
  rollbackBackups: readonly string[];
}

export interface BackupRestoreOptions {
  databasePath: string;
  jobsDatabasePath?: string;
  backupDirectory: string;
  maxUploadBytes?: number;
}

export interface BackupRestoreService {
  readonly maxUploadBytes: number;
  listVerifiedBackups(): Promise<readonly VerifiedBackup[]>;
  getStagedRestore(): Promise<StagedRestore | null>;
  stageRestore(bytes: Uint8Array): Promise<StagedRestore>;
  cancelStagedRestore(): Promise<boolean>;
  applyStagedRestore(): Promise<AppliedRestore>;
}

/**
 * Manages restore images using only application-owned, fixed paths. No caller
 * can supply a filesystem path, which keeps the upload/list API from becoming
 * a general file reader or writer.
 */
export function createBackupRestoreService(
  options: BackupRestoreOptions,
): BackupRestoreService {
  const maxUploadBytes = options.maxUploadBytes ?? DEFAULT_RESTORE_MAX_BYTES;
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes < 1) {
    throw new TypeError("Restore upload limit must be a positive integer");
  }

  const backupDirectory = resolve(options.backupDirectory);
  const databasePath =
    options.databasePath === ":memory:"
      ? ":memory:"
      : resolve(options.databasePath);
  const jobsDatabasePath =
    options.jobsDatabasePath === undefined ||
    options.jobsDatabasePath === ":memory:"
      ? undefined
      : resolve(options.jobsDatabasePath);
  const stagingRoot =
    databasePath === ":memory:"
      ? resolve(backupDirectory, STAGING_DIRECTORY)
      : resolve(dirname(databasePath), STAGING_DIRECTORY);
  const stagedPath = fixedChild(stagingRoot, STAGED_FILENAME);

  return {
    maxUploadBytes,
    async listVerifiedBackups() {
      let names: string[];
      try {
        names = await readdir(backupDirectory);
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }

      const backups: VerifiedBackup[] = [];
      for (const name of names.filter((candidate) =>
        /^bobarr(?:-pre-restore)?-\d{4}-\d{2}-\d{2}T[\d-]+Z\.sqlite$/.test(
          candidate,
        ),
      )) {
        const path = fixedChild(backupDirectory, name);
        try {
          // Verify sequentially to keep a large retained backup set from
          // multiplying SQLite and hashing memory pressure.
          backups.push(await inspectBackup(path, name));
        } catch {
          // The public listing contains verified application images only.
        }
      }
      return backups.sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      );
    },
    async getStagedRestore() {
      try {
        const inspected = await inspectBackup(stagedPath, STAGED_FILENAME);
        return asStagedRestore(inspected);
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async stageRestore(bytes) {
      if (databasePath === ":memory:") {
        throw new Error(
          "Restore staging is unavailable for an in-memory database",
        );
      }
      if (bytes.byteLength === 0 || bytes.byteLength > maxUploadBytes) {
        throw new RangeError(
          `Restore image must be between 1 and ${maxUploadBytes} bytes`,
        );
      }
      assertSqliteHeader(bytes);

      await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
      const temporary = fixedChild(
        stagingRoot,
        `.${STAGED_FILENAME}.${crypto.randomUUID()}.tmp`,
      );
      try {
        await Bun.write(temporary, bytes);
        await chmod(temporary, 0o600);
        await inspectBackup(temporary, STAGED_FILENAME, true);
        await rename(temporary, stagedPath);
        return asStagedRestore(
          await inspectBackup(stagedPath, STAGED_FILENAME),
        );
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
    },
    async cancelStagedRestore() {
      try {
        await unlink(stagedPath);
        return true;
      } catch (error) {
        if (isMissing(error)) return false;
        throw error;
      }
    },
    async applyStagedRestore() {
      if (databasePath === ":memory:") {
        return { applied: false, rollbackBackups: [] };
      }
      try {
        await inspectBackup(stagedPath, STAGED_FILENAME);
      } catch (error) {
        if (isMissing(error)) return { applied: false, rollbackBackups: [] };
        throw new Error("The staged Bobarr restore is invalid", {
          cause: error,
        });
      }

      await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 });
      await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
      const rollbackBackups: string[] = [];
      if (await regularFileExists(databasePath)) {
        rollbackBackups.push(
          await createRollback(
            databasePath,
            backupDirectory,
            "bobarr-pre-restore",
          ),
        );
      }
      if (
        jobsDatabasePath !== undefined &&
        (await regularFileExists(jobsDatabasePath))
      ) {
        rollbackBackups.push(
          await createRollback(
            jobsDatabasePath,
            backupDirectory,
            "jobs-pre-restore",
          ),
        );
      }

      // Both databases are closed at this point. Remove stale WAL sidecars
      // before the atomic replacement so they cannot be replayed into the
      // restored image after a crash or unclean previous shutdown.
      await removeSqliteSidecars(databasePath);
      if (jobsDatabasePath !== undefined) {
        await removeSqliteSidecars(jobsDatabasePath);
        await unlink(jobsDatabasePath).catch((error) => {
          if (!isMissing(error)) throw error;
        });
      }
      await rename(stagedPath, databasePath);
      await chmod(databasePath, 0o600);
      return { applied: true, rollbackBackups };
    },
  };
}

async function inspectBackup(
  path: string,
  name: string,
  normalizeJournalMode = false,
): Promise<VerifiedBackup> {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error("Backup image must be a regular file");
  }
  const header = new Uint8Array(
    await Bun.file(path).slice(0, 16).arrayBuffer(),
  );
  assertSqliteHeader(header);
  const database = new Database(path, {
    readonly: !normalizeJournalMode,
    readwrite: normalizeJournalMode,
    strict: true,
  });
  let migrationVersion: number;
  try {
    if (normalizeJournalMode) database.exec("PRAGMA journal_mode = DELETE");
    const integrity = database
      .query<{ integrity_check: string }, []>("PRAGMA integrity_check")
      .get();
    if (integrity?.integrity_check !== "ok") {
      throw new Error("SQLite integrity check failed");
    }
    migrationVersion = verifyMigrationHistory(database);
  } finally {
    database.close(false);
  }
  const sha256 = await hashFile(path);
  return {
    name,
    sizeBytes: details.size,
    createdAt: details.mtime.toISOString(),
    migrationVersion,
    sha256,
    verified: true,
  };
}

async function hashFile(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const reader = Bun.file(path).stream().getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      hasher.update(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return hasher.digest("hex");
}

function asStagedRestore(backup: VerifiedBackup): StagedRestore {
  return {
    sizeBytes: backup.sizeBytes,
    stagedAt: backup.createdAt,
    migrationVersion: backup.migrationVersion,
    sha256: backup.sha256,
    restartRequired: true,
  };
}

async function createRollback(
  path: string,
  directory: string,
  prefix: string,
): Promise<string> {
  const database = new Database(path, { readwrite: true, strict: true });
  try {
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return (
      await createSqliteBackup(database, {
        directory,
        prefix,
        retention: 14,
      })
    ).path;
  } finally {
    database.close(false);
  }
}

async function removeSqliteSidecars(path: string): Promise<void> {
  for (const suffix of ["-wal", "-shm"] as const) {
    await unlink(`${path}${suffix}`).catch((error) => {
      if (!isMissing(error)) throw error;
    });
  }
}

async function regularFileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function assertSqliteHeader(bytes: Uint8Array): void {
  if (
    bytes.byteLength < SQLITE_HEADER.byteLength ||
    SQLITE_HEADER.some((value, index) => bytes[index] !== value)
  ) {
    throw new Error("Upload is not a SQLite database image");
  }
}

function fixedChild(root: string, name: string): string {
  if (name.includes("/") || name.includes("\\") || name === "..") {
    throw new Error("Unsafe generated backup name");
  }
  const child = resolve(root, name);
  if (dirname(child) !== resolve(root)) {
    throw new Error("Backup path escaped its configured root");
  }
  return child;
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
