import type { BackendDatabase } from "../db";
import type { ReleaseTarget } from "../domain/releases";
import type {
  DownloadPatch,
  DownloadRecord,
  DownloadRepository,
  DownloadState,
} from "./ports";

import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { downloads, releaseCandidates } from "../db";

type DownloadRow = typeof downloads.$inferSelect;

/**
 * Creates the durable application-layer download repository backed by the
 * primary Bobarr SQLite database.
 */
export function downloadRepositoryFromDatabase(
  database: BackendDatabase,
): DownloadRepository {
  return new SqliteAcquisitionDownloadRepository(database);
}

/**
 * Persists the restart-safe acquisition state machine without exposing its
 * protected source payload through the public download repository.
 */
export class SqliteAcquisitionDownloadRepository implements DownloadRepository {
  constructor(private readonly database: BackendDatabase) {}

  async insert(download: DownloadRecord): Promise<void> {
    validateRecord(download);
    const mediaItemId = download.candidateId
      ? (this.database.client
          .select({ mediaItemId: releaseCandidates.mediaItemId })
          .from(releaseCandidates)
          .where(eq(releaseCandidates.id, download.candidateId))
          .get()?.mediaItemId ?? null)
      : null;
    this.database.client
      .insert(downloads)
      .values({
        id: download.id,
        mediaItemId,
        releaseCandidateId: download.candidateId,
        client: "transmission",
        externalId: download.engineInfoHash,
        title: download.title,
        state: toPublicState(download.state),
        progress: toPublicProgress(download.progress),
        downloadPath: download.downloadDirectory,
        error: download.error,
        createdAt: download.createdAt,
        updatedAt: download.updatedAt,
        completedAt: download.state === "organized" ? download.updatedAt : null,
        acquisitionState: download.state,
        targetJson: JSON.stringify(download.target),
        sourceCiphertext: download.sourceCiphertext,
        expectedInfoHash: download.expectedInfoHash,
        engineInfoHash: download.engineInfoHash,
        engineName: download.engineName,
        engineLabel: download.engineLabel,
        downloadDirectory: download.downloadDirectory,
        acquisitionProgress: download.progress,
        pausedRequested: download.pausedRequested,
        peerLimit: download.peerLimit,
        lastEngineSeenAt: download.lastEngineSeenAt,
      })
      .run();
  }

  async findById(id: string): Promise<DownloadRecord | null> {
    const row = this.database.client
      .select()
      .from(downloads)
      .where(and(eq(downloads.id, id), isNotNull(downloads.acquisitionState)))
      .get();
    return row === undefined ? null : mapRecord(row);
  }

  async listForReconciliation(): Promise<readonly DownloadRecord[]> {
    return this.database.client
      .select()
      .from(downloads)
      .where(isNotNull(downloads.acquisitionState))
      .orderBy(downloads.createdAt, downloads.id)
      .all()
      .map(mapRecord);
  }

  async transition(
    id: string,
    expectedStates: readonly DownloadState[],
    patch: DownloadPatch,
  ): Promise<DownloadRecord | null> {
    if (expectedStates.length === 0) return null;
    if (patch.progress !== undefined) validateProgress(patch.progress);

    const values: Partial<typeof downloads.$inferInsert> = {
      updatedAt: patch.updatedAt,
    };
    if (patch.state !== undefined) {
      values.acquisitionState = patch.state;
      values.state = toPublicState(patch.state);
      if (patch.state === "organized") {
        values.completedAt = patch.updatedAt;
      }
    }
    if (patch.engineInfoHash !== undefined) {
      values.engineInfoHash = patch.engineInfoHash;
      values.externalId = patch.engineInfoHash;
    }
    // Keep the durable engine identity for audit/recovery, but release the
    // public uniqueness key once Transmission no longer owns this download.
    // This permits a later acquisition of the same infohash.
    if (patch.state === "removed") values.externalId = null;
    if (patch.engineName !== undefined) {
      values.engineName = patch.engineName;
    }
    if (patch.progress !== undefined) {
      values.acquisitionProgress = patch.progress;
      values.progress = toPublicProgress(patch.progress);
    }
    if (patch.error !== undefined) values.error = patch.error;
    if (patch.lastEngineSeenAt !== undefined) {
      values.lastEngineSeenAt = patch.lastEngineSeenAt;
    }

    const row = this.database.client
      .update(downloads)
      .set(values)
      .where(
        and(
          eq(downloads.id, id),
          inArray(downloads.acquisitionState, [...new Set(expectedStates)]),
        ),
      )
      .returning()
      .get();
    return row === undefined ? null : mapRecord(row);
  }
}

function mapRecord(row: DownloadRow): DownloadRecord {
  if (
    row.acquisitionState === null ||
    row.targetJson === null ||
    row.sourceCiphertext === null ||
    row.engineLabel === null ||
    row.downloadDirectory === null
  ) {
    throw new TypeError(`Download ${row.id} has incomplete acquisition data`);
  }

  return {
    id: row.id,
    candidateId: row.releaseCandidateId,
    target: parseTarget(row.targetJson, row.id),
    title: row.title,
    state: row.acquisitionState,
    sourceCiphertext: row.sourceCiphertext,
    expectedInfoHash: row.expectedInfoHash,
    engineInfoHash: row.engineInfoHash,
    engineName: row.engineName,
    engineLabel: row.engineLabel,
    downloadDirectory: row.downloadDirectory,
    progress: row.acquisitionProgress,
    error: row.error,
    pausedRequested: row.pausedRequested,
    peerLimit: row.peerLimit,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastEngineSeenAt: row.lastEngineSeenAt,
  };
}

function parseTarget(value: string, downloadId: string): ReleaseTarget {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError(`Download ${downloadId} has an invalid target`);
  }
  if (!isReleaseTarget(parsed)) {
    throw new TypeError(`Download ${downloadId} has an invalid target`);
  }
  return parsed;
}

function isReleaseTarget(value: unknown): value is ReleaseTarget {
  if (typeof value !== "object" || value === null) return false;
  const target = value as Record<string, unknown>;
  if (
    !["movie", "season", "episode"].includes(String(target["kind"])) ||
    typeof target["title"] !== "string" ||
    target["title"].trim().length === 0
  ) {
    return false;
  }
  if (
    target["alternateTitles"] !== undefined &&
    (!Array.isArray(target["alternateTitles"]) ||
      !target["alternateTitles"].every((title) => typeof title === "string"))
  ) {
    return false;
  }
  for (const field of ["year", "season", "episode"] as const) {
    const fieldValue = target[field];
    if (fieldValue !== undefined && !Number.isInteger(fieldValue)) return false;
  }
  if (
    target["releaseDate"] !== undefined &&
    target["releaseDate"] !== null &&
    (typeof target["releaseDate"] !== "string" ||
      !Number.isFinite(Date.parse(target["releaseDate"])))
  ) {
    return false;
  }
  return true;
}

function validateRecord(download: DownloadRecord): void {
  validateProgress(download.progress);
  if (download.peerLimit !== null && download.peerLimit <= 0) {
    throw new RangeError("Download peerLimit must be positive");
  }
  if (!isReleaseTarget(download.target)) {
    throw new TypeError("Download target is invalid");
  }
}

function validateProgress(progress: number): void {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError("Download progress must be between 0 and 1");
  }
}

function toPublicProgress(progress: number): number {
  return Math.round(progress * 10_000) / 100;
}

function toPublicState(
  state: DownloadState,
): (typeof downloads.$inferInsert)["state"] {
  switch (state) {
    case "queued":
    case "submitting":
      return "queued";
    case "downloading":
      return "downloading";
    case "paused":
      return "paused";
    case "completed":
      return "seeding";
    case "organizing":
      return "organizing";
    case "organized":
      return "completed";
    case "missing":
    case "failed":
    case "removed":
      return "failed";
  }
}
