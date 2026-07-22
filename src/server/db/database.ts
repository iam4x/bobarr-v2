import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import { runMigrations } from "./migrations";
import { databaseSchema, type DatabaseSchema } from "./schema";

export interface BackendDatabase {
  client: BunSQLiteDatabase<DatabaseSchema>;
  sqlite: Database;
  migrationVersion: number;
  close(): void;
}

export async function openBackendDatabase(
  path: string,
): Promise<BackendDatabase> {
  if (path !== ":memory:") {
    await mkdir(dirname(path), { recursive: true });
  }

  const sqlite = new Database(path, {
    create: true,
    readwrite: true,
    strict: true,
  });
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  if (path !== ":memory:") {
    sqlite.exec("PRAGMA journal_mode = WAL;");
    sqlite.exec("PRAGMA synchronous = NORMAL;");
  }

  try {
    const migrationVersion = runMigrations(sqlite);
    const client = drizzle(sqlite, { schema: databaseSchema });
    return {
      client,
      sqlite,
      migrationVersion,
      close: () => sqlite.close(false),
    };
  } catch (error) {
    sqlite.close(false);
    throw error;
  }
}
