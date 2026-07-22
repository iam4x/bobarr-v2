import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSqliteBackup } from "./backup";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("SQLite backups", () => {
  test("creates a verified snapshot and enforces retention", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bobarr-backup-"));
    temporaryDirectories.push(directory);
    const database = new Database(":memory:");
    database.exec(
      "CREATE TABLE example (value TEXT); INSERT INTO example VALUES ('safe');",
    );

    await createSqliteBackup(database, {
      directory,
      retention: 1,
      now: new Date("2026-07-20T12:00:00.000Z"),
    });
    const second = await createSqliteBackup(database, {
      directory,
      retention: 1,
      now: new Date("2026-07-21T12:00:00.000Z"),
    });
    database.close();

    expect(await readdir(directory)).toEqual([
      "bobarr-2026-07-21T12-00-00-000Z.sqlite",
    ]);
    const snapshot = new Database(second.path, { readonly: true });
    expect(snapshot.query("SELECT value FROM example").get()).toEqual({
      value: "safe",
    });
    snapshot.close();
  });
});
