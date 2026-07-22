import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSqliteBackup } from "./backup";
import { createBackupRestoreService } from "./restore";
import { openBackendDatabase } from "../db";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("staged database restore", () => {
  test("lists verified images and atomically applies a staged restore with rollbacks", async () => {
    const root = await temporaryRoot();
    const databasePath = join(root, "bobarr.sqlite");
    const jobsPath = join(root, "jobs.sqlite");
    const backupDirectory = join(root, "backups");

    const current = await openBackendDatabase(databasePath);
    current.sqlite.exec(
      "CREATE TABLE restore_marker (value TEXT); INSERT INTO restore_marker VALUES ('current')",
    );
    await createSqliteBackup(current.sqlite, {
      directory: backupDirectory,
      now: new Date("2026-07-21T12:00:00.000Z"),
    });
    current.close();

    const jobs = new Database(jobsPath, { create: true });
    jobs.exec("CREATE TABLE job_marker (value TEXT)");
    jobs.close();

    const candidatePath = join(root, "candidate.sqlite");
    const candidate = await openBackendDatabase(candidatePath);
    candidate.sqlite.exec(
      "CREATE TABLE restore_marker (value TEXT); INSERT INTO restore_marker VALUES ('restored')",
    );
    const candidateBytes = candidate.sqlite.serialize("main");
    candidate.close();

    const restore = createBackupRestoreService({
      databasePath,
      jobsDatabasePath: jobsPath,
      backupDirectory,
    });
    const listed = await restore.listVerifiedBackups();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      name: "bobarr-2026-07-21T12-00-00-000Z.sqlite",
      verified: true,
      migrationVersion: 5,
    });

    const staged = await restore.stageRestore(candidateBytes);
    expect(staged).toMatchObject({
      migrationVersion: 5,
      restartRequired: true,
    });
    expect(await restore.getStagedRestore()).toEqual(staged);

    const applied = await restore.applyStagedRestore();
    expect(applied.applied).toBe(true);
    expect(applied.rollbackBackups).toHaveLength(2);
    expect(await restore.getStagedRestore()).toBeNull();

    const restored = new Database(databasePath, { readonly: true });
    expect(restored.query("SELECT value FROM restore_marker").get()).toEqual({
      value: "restored",
    });
    restored.close();
    expect(await Bun.file(jobsPath).exists()).toBe(false);

    const names = await readdir(backupDirectory);
    expect(names.some((name) => name.startsWith("bobarr-pre-restore-"))).toBe(
      true,
    );
    expect(names.some((name) => name.startsWith("jobs-pre-restore-"))).toBe(
      true,
    );
  });

  test("rejects corrupt, unrelated, and oversized images without staging them", async () => {
    const root = await temporaryRoot();
    const unrelated = new Database(":memory:");
    unrelated.exec("CREATE TABLE unrelated (value TEXT)");
    const unrelatedBytes = unrelated.serialize("main");
    unrelated.close();

    const restore = createBackupRestoreService({
      databasePath: join(root, "bobarr.sqlite"),
      backupDirectory: join(root, "backups"),
      maxUploadBytes: unrelatedBytes.byteLength + 1,
    });
    await expect(
      restore.stageRestore(new Uint8Array([1, 2, 3])),
    ).rejects.toThrow("not a SQLite");
    await expect(restore.stageRestore(unrelatedBytes)).rejects.toThrow(
      "Not a Bobarr",
    );
    expect(await restore.getStagedRestore()).toBeNull();

    const capped = createBackupRestoreService({
      databasePath: join(root, "bobarr.sqlite"),
      backupDirectory: join(root, "backups"),
      maxUploadBytes: 16,
    });
    await expect(capped.stageRestore(unrelatedBytes)).rejects.toThrow(
      "must be between",
    );
  });

  test("can cancel a verified staged image", async () => {
    const root = await temporaryRoot();
    const candidate = await openBackendDatabase(join(root, "candidate.sqlite"));
    const bytes = candidate.sqlite.serialize("main");
    candidate.close();
    const restore = createBackupRestoreService({
      databasePath: join(root, "bobarr.sqlite"),
      backupDirectory: join(root, "backups"),
    });

    await restore.stageRestore(bytes);
    expect(await restore.cancelStagedRestore()).toBe(true);
    expect(await restore.cancelStagedRestore()).toBe(false);
  });
});

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "bobarr-restore-"));
  temporaryDirectories.push(directory);
  return directory;
}
