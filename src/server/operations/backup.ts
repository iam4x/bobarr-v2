import { Database } from "bun:sqlite";
import { chmod, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface BackupResult {
  path: string;
  sizeBytes: number;
  removed: readonly string[];
}

export interface BackupOptions {
  directory: string;
  prefix?: string;
  retention?: number;
  now?: Date;
}

/** Create a transactionally consistent SQLite image and prune older images. */
export async function createSqliteBackup(
  database: Database,
  options: BackupOptions,
): Promise<BackupResult> {
  const prefix = options.prefix ?? "bobarr";
  const retention = options.retention ?? 14;
  if (!/^[a-z][a-z0-9_-]{0,49}$/i.test(prefix)) {
    throw new TypeError("Backup prefix is invalid");
  }
  if (!Number.isSafeInteger(retention) || retention < 1 || retention > 365) {
    throw new TypeError("Backup retention must be between 1 and 365");
  }

  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const timestamp = (options.now ?? new Date())
    .toISOString()
    .replace(/[:.]/g, "-");
  const filename = `${prefix}-${timestamp}.sqlite`;
  const destination = join(options.directory, filename);
  const temporary = join(
    options.directory,
    `.${filename}.${crypto.randomUUID()}.tmp`,
  );
  const image = database.serialize("main");

  try {
    await Bun.write(temporary, image);
    await chmod(temporary, 0o600);
    verifySqliteImage(temporary);
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }

  const removed = await pruneBackups(options.directory, prefix, retention);
  return {
    path: destination,
    sizeBytes: (await stat(destination)).size,
    removed,
  };
}

function verifySqliteImage(path: string): void {
  const snapshot = new Database(path, { readwrite: true, strict: true });
  try {
    // A serialized live WAL database can retain WAL journal mode even though
    // the transactionally consistent image has no sidecars. Normalize the
    // copied image so it remains independently readable after transport.
    snapshot.exec("PRAGMA journal_mode = DELETE");
    const result = snapshot
      .query<{ integrity_check: string }, []>("PRAGMA integrity_check")
      .get();
    if (result?.integrity_check !== "ok") {
      throw new Error("The generated SQLite backup failed its integrity check");
    }
  } finally {
    snapshot.close(false);
  }
}

async function pruneBackups(
  directory: string,
  prefix: string,
  retention: number,
): Promise<string[]> {
  const pattern = new RegExp(
    `^${escapeRegularExpression(prefix)}-\\d{4}-\\d{2}-\\d{2}T.*\\.sqlite$`,
  );
  const names = (await readdir(directory))
    .filter((name) => pattern.test(name))
    .sort()
    .reverse();
  const removed: string[] = [];
  for (const name of names.slice(retention)) {
    const path = join(directory, name);
    await unlink(path);
    removed.push(path);
  }
  return removed;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
