import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openBackendDatabase } from "./database";

describe("database durability", () => {
  test("durably commits filesystem recovery records before allowing source cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "bobarr-durable-database-"));
    const path = join(root, "bobarr.sqlite");
    const database = await openBackendDatabase(path);
    try {
      expect(database.sqlite.query("PRAGMA journal_mode").get()).toEqual({
        journal_mode: "wal",
      });
      expect(database.sqlite.query("PRAGMA synchronous").get()).toEqual({
        synchronous: 2,
      });
      expect(database.sqlite.query("PRAGMA fullfsync").get()).toEqual({
        fullfsync: 1,
      });
      database.sqlite.transaction(() => {
        database.sqlite
          .query(
            "INSERT INTO volume_transfers (id, group_key, stage, manifest_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run("durable", "movie:durable", "committed", "{}", 1, 1);
      })();
      const reopened = await openBackendDatabase(path);
      try {
        expect(
          reopened.sqlite
            .query("SELECT stage FROM volume_transfers WHERE id = ?")
            .get("durable"),
        ).toEqual({ stage: "committed" });
      } finally {
        reopened.close();
      }
    } finally {
      database.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
