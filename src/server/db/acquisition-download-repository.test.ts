import type { DownloadRecord } from "../application";

import { describe, expect, test } from "bun:test";

import { createRepositories, openBackendDatabase, runMigrations } from ".";
import {
  CreateDownloadInputSchema,
  DownloadsQuerySchema,
} from "../../contracts";
import {
  downloadRepositoryFromDatabase,
  SqliteAcquisitionDownloadRepository,
} from "../application";

describe("durable acquisition download repository", () => {
  test("persists protected restart state and mirrors the public projection", async () => {
    const database = await openBackendDatabase(":memory:");
    try {
      const repository = downloadRepositoryFromDatabase(database);
      const record = acquisitionDownload();
      await repository.insert(record);

      expect(await repository.findById(record.id)).toEqual(record);
      expect(await repository.listForReconciliation()).toEqual([record]);

      expect(
        await repository.transition(record.id, ["downloading"], {
          state: "failed",
          error: "must not win",
          updatedAt: record.updatedAt + 1,
        }),
      ).toBeNull();

      const submitting = await repository.transition(record.id, ["queued"], {
        state: "submitting",
        updatedAt: record.updatedAt + 1,
      });
      expect(submitting?.state).toBe("submitting");

      const downloading = await repository.transition(
        record.id,
        ["submitting"],
        {
          state: "downloading",
          engineInfoHash: "0123456789abcdef0123456789abcdef01234567",
          engineName: "Example Movie",
          progress: 0.375,
          error: null,
          lastEngineSeenAt: record.updatedAt + 2,
          updatedAt: record.updatedAt + 2,
        },
      );
      expect(downloading).toMatchObject({
        state: "downloading",
        progress: 0.375,
        engineName: "Example Movie",
        lastEngineSeenAt: record.updatedAt + 2,
      });

      const publicRepository = createRepositories(database).downloads;
      expect(publicRepository.get(record.id)).toMatchObject({
        id: record.id,
        client: "transmission",
        externalId: "0123456789abcdef0123456789abcdef01234567",
        state: "downloading",
        progress: 37.5,
        downloadPath: record.downloadDirectory,
      });
      expect(
        "sourceCiphertext" in (publicRepository.get(record.id) ?? {}),
      ).toBe(false);

      await repository.transition(record.id, ["downloading"], {
        state: "completed",
        progress: 1,
        updatedAt: record.updatedAt + 3,
      });
      expect(publicRepository.get(record.id)?.state).toBe("seeding");

      await repository.transition(record.id, ["completed"], {
        state: "organizing",
        updatedAt: record.updatedAt + 4,
      });
      await repository.transition(record.id, ["organizing"], {
        state: "organized",
        updatedAt: record.updatedAt + 5,
      });
      expect(publicRepository.get(record.id)).toMatchObject({
        state: "completed",
        completedAt: new Date(record.updatedAt + 5).toISOString(),
      });

      await repository.transition(record.id, ["organized"], {
        state: "removed",
        updatedAt: record.updatedAt + 6,
      });
      expect((await repository.findById(record.id))?.state).toBe("removed");
      expect(
        database.sqlite
          .query<
            { externalId: string | null; engineInfoHash: string | null },
            [string]
          >(
            "SELECT external_id AS externalId, engine_info_hash AS engineInfoHash FROM downloads WHERE id = ?",
          )
          .get(record.id),
      ).toEqual({
        externalId: null,
        engineInfoHash: "0123456789abcdef0123456789abcdef01234567",
      });
      expect(publicRepository.get(record.id)).toBeUndefined();
      expect(
        publicRepository.list(DownloadsQuerySchema.parse({})).downloads,
      ).toEqual([]);

      const reacquired = acquisitionDownload();
      await repository.insert(reacquired);
      await repository.transition(reacquired.id, ["queued"], {
        state: "submitting",
        updatedAt: reacquired.updatedAt + 1,
      });
      await expect(
        repository.transition(reacquired.id, ["submitting"], {
          state: "downloading",
          engineInfoHash: "0123456789abcdef0123456789abcdef01234567",
          updatedAt: reacquired.updatedAt + 2,
        }),
      ).resolves.toMatchObject({ state: "downloading" });
    } finally {
      database.close();
    }
  });

  test("migration clears legacy removed public identities only", async () => {
    const database = await openBackendDatabase(":memory:");
    try {
      const repository = downloadRepositoryFromDatabase(database);
      const record = acquisitionDownload();
      await repository.insert(record);
      await repository.transition(record.id, ["queued"], {
        state: "submitting",
        updatedAt: record.updatedAt + 1,
      });
      await repository.transition(record.id, ["submitting"], {
        state: "downloading",
        engineInfoHash: "0123456789abcdef0123456789abcdef01234567",
        updatedAt: record.updatedAt + 2,
      });
      database.sqlite
        .query(
          "UPDATE downloads SET acquisition_state = 'removed', state = 'failed' WHERE id = ?",
        )
        .run(record.id);
      database.sqlite
        .query("DELETE FROM schema_migrations WHERE version = 5")
        .run();

      expect(runMigrations(database.sqlite)).toBe(5);
      expect(
        database.sqlite
          .query<
            { externalId: string | null; engineInfoHash: string | null },
            [string]
          >(
            "SELECT external_id AS externalId, engine_info_hash AS engineInfoHash FROM downloads WHERE id = ?",
          )
          .get(record.id),
      ).toEqual({
        externalId: null,
        engineInfoHash: "0123456789abcdef0123456789abcdef01234567",
      });
    } finally {
      database.close();
    }
  });

  test("keeps legacy public rows readable and outside reconciliation", async () => {
    const database = await openBackendDatabase(":memory:");
    try {
      expect(database.migrationVersion).toBe(5);
      const publicRepository = createRepositories(database).downloads;
      const legacy = publicRepository.create(
        CreateDownloadInputSchema.parse({ title: "Legacy download" }),
      );
      const acquisitionRepository = new SqliteAcquisitionDownloadRepository(
        database,
      );

      expect(publicRepository.get(legacy.id)).toEqual(legacy);
      expect(await acquisitionRepository.findById(legacy.id)).toBeNull();
      expect(await acquisitionRepository.listForReconciliation()).toEqual([]);
    } finally {
      database.close();
    }
  });

  test("rejects invalid durable progress before writing", async () => {
    const database = await openBackendDatabase(":memory:");
    try {
      const repository = downloadRepositoryFromDatabase(database);
      await expect(
        repository.insert({ ...acquisitionDownload(), progress: 1.01 }),
      ).rejects.toThrow("between 0 and 1");
    } finally {
      database.close();
    }
  });
});

function acquisitionDownload(): DownloadRecord {
  const id = crypto.randomUUID();
  const now = Date.parse("2026-07-21T12:00:00.000Z");
  return {
    id,
    candidateId: null,
    target: { kind: "movie", title: "Example Movie", year: 2026 },
    title: "Example.Movie.2026.1080p.WEB-DL",
    state: "queued",
    sourceCiphertext: "sealed:private-source",
    expectedInfoHash: "0123456789abcdef0123456789abcdef01234567",
    engineInfoHash: null,
    engineName: null,
    engineLabel: `bobarr:${id}`,
    downloadDirectory: `/media/downloads/${id}`,
    progress: 0,
    error: null,
    pausedRequested: false,
    peerLimit: 50,
    createdAt: now,
    updatedAt: now,
    lastEngineSeenAt: null,
  };
}
