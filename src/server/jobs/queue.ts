import type { Job, JobStatus } from "../../contracts/jobs";

import { Database } from "bun:sqlite";

import { redactText } from "../core";

export type JobState = JobStatus;

export interface DurableJob<T = unknown> {
  id: string;
  type: string;
  payload: T;
  state: JobState;
  dedupeKey: string | null;
  priority: number;
  attempt: number;
  maxAttempts: number;
  runAt: number;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface JobLogEntry {
  timestamp: number;
  level: "info" | "warn" | "error";
  event: string;
  message: string | null;
}

export interface EnqueueJob<T = unknown> {
  id?: string;
  type: string;
  payload: T;
  dedupeKey?: string;
  priority?: number;
  maxAttempts?: number;
  runAt?: number;
}

export interface ClaimJobOptions {
  workerId: string;
  leaseMs: number;
  now?: number;
  types?: readonly string[];
}

export interface FailJobOptions {
  retryAt?: number;
  now?: number;
}

export interface JobListFilter {
  states?: readonly JobState[];
  types?: readonly string[];
  limit?: number;
  offset?: number;
}

export interface JobQueue {
  enqueue<T>(input: EnqueueJob<T>): Promise<DurableJob<T>>;
  get<T = unknown>(id: string): Promise<DurableJob<T> | null>;
  list(filter?: JobListFilter): Promise<readonly DurableJob[]>;
  count(filter?: Pick<JobListFilter, "states" | "types">): Promise<number>;
  logs(id: string): Promise<readonly JobLogEntry[]>;
  claim(options: ClaimJobOptions): Promise<DurableJob | null>;
  heartbeat(
    id: string,
    leaseToken: string,
    leaseMs: number,
    now?: number,
  ): Promise<void>;
  complete(id: string, leaseToken: string, now?: number): Promise<void>;
  fail(
    id: string,
    leaseToken: string,
    error: unknown,
    options?: FailJobOptions,
  ): Promise<void>;
  cancel(id: string, now?: number): Promise<boolean>;
  requeueExpired(now?: number): Promise<number>;
  close(): void;
}

export interface SqliteJobQueueOptions {
  database: Database | string;
  initialize?: boolean;
  now?: () => number;
  id?: () => string;
}

interface JobRow {
  id: string;
  type: string;
  payload_json: string;
  state: JobState;
  dedupe_key: string | null;
  priority: number;
  attempt: number;
  max_attempts: number;
  run_at: number;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export const JOB_QUEUE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  dedupe_key TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  run_at INTEGER NOT NULL,
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_dedupe_idx
  ON jobs(type, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND state IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS jobs_claim_idx
  ON jobs(state, run_at, priority DESC, created_at);

CREATE INDEX IF NOT EXISTS jobs_lease_idx
  ON jobs(state, lease_expires_at)
  WHERE state = 'running';

CREATE TABLE IF NOT EXISTS job_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  timestamp INTEGER NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  event TEXT NOT NULL,
  message TEXT
);

CREATE INDEX IF NOT EXISTS job_logs_job_idx
  ON job_logs(job_id, timestamp, id);
`;

export class JobLeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Lease for job ${jobId} is no longer owned by this worker`);
    this.name = "JobLeaseLostError";
  }
}

export function durableJobToContract(job: DurableJob): Job {
  const payload = isObjectPayload(job.payload)
    ? job.payload
    : { value: job.payload };
  const terminal =
    job.state === "completed" ||
    job.state === "failed" ||
    job.state === "cancelled";
  return {
    id: job.id,
    kind: job.type,
    status: job.state,
    progress: job.state === "completed" ? 100 : 0,
    message: job.lastError,
    payload,
    result: null,
    error:
      job.state === "failed"
        ? {
            message: job.lastError ?? "Job failed",
            attempt: job.attempt,
            maxAttempts: job.maxAttempts,
          }
        : null,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    runAt: new Date(job.runAt).toISOString(),
    priority: job.priority,
    dedupeKey: job.dedupeKey,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
    startedAt: job.attempt > 0 ? new Date(job.updatedAt).toISOString() : null,
    finishedAt:
      terminal && job.completedAt !== null
        ? new Date(job.completedAt).toISOString()
        : null,
  };
}

export function createSqliteJobQueue(options: SqliteJobQueueOptions): JobQueue {
  const databaseOption = options.database;
  const ownsDatabase = typeof databaseOption === "string";
  const database: Database =
    typeof databaseOption === "string"
      ? new Database(databaseOption, { create: true })
      : databaseOption;
  const now = options.now ?? Date.now;
  const createId = options.id ?? (() => crypto.randomUUID());
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (ownsDatabase && databaseOption !== ":memory:") {
    database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  }
  if (options.initialize !== false) database.exec(JOB_QUEUE_SCHEMA_SQL);

  const selectById = database.query("SELECT * FROM jobs WHERE id = ?1");
  const selectActiveDedupe = database.query(
    "SELECT * FROM jobs WHERE type = ?1 AND dedupe_key = ?2 AND state IN ('queued', 'running') LIMIT 1",
  );
  const insertLog = database.query(
    `INSERT INTO job_logs (job_id, timestamp, level, event, message)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  );

  async function enqueue<T>(input: EnqueueJob<T>): Promise<DurableJob<T>> {
    validateEnqueue(input);
    const timestamp = now();
    const id = input.id ?? createId();
    const payloadJson = serializePayload(input.payload);
    const dedupeKey = input.dedupeKey?.trim() || null;
    const insert = database.query(`
      INSERT OR IGNORE INTO jobs (
        id, type, payload_json, state, dedupe_key, priority, attempt,
        max_attempts, run_at, created_at, updated_at
      ) VALUES (?1, ?2, ?3, 'queued', ?4, ?5, 0, ?6, ?7, ?8, ?8)
    `);
    const result = insert.run(
      id,
      input.type,
      payloadJson,
      dedupeKey,
      input.priority ?? 0,
      input.maxAttempts ?? 5,
      input.runAt ?? timestamp,
      timestamp,
    );
    if (result.changes === 1) {
      const scheduled = input.runAt !== undefined && input.runAt > timestamp;
      insertLog.run(
        id,
        timestamp,
        "info",
        scheduled ? "job.scheduled" : "job.queued",
        scheduled
          ? `Scheduled for ${new Date(input.runAt!).toISOString()}`
          : "Ready for a worker",
      );
      return rowToJob(requireRow(selectById.get(id))) as DurableJob<T>;
    }
    if (dedupeKey) {
      const existing = selectActiveDedupe.get(input.type, dedupeKey);
      if (existing) return rowToJob(existing as JobRow) as DurableJob<T>;
    }
    throw new Error(`Could not enqueue job ${id}; its id already exists`);
  }

  async function claim(
    claimOptions: ClaimJobOptions,
  ): Promise<DurableJob | null> {
    validateClaim(claimOptions);
    const timestamp = claimOptions.now ?? now();
    const leaseToken = createId();
    const typeFilter = queryFilter("type", claimOptions.types, 2);
    const transaction = database.transaction((): DurableJob | null => {
      requeueExpiredSync(database, timestamp);
      const row = database
        .query(
          `SELECT * FROM jobs
           WHERE state = 'queued' AND run_at <= ?1 ${typeFilter.sql}
           ORDER BY priority DESC, run_at ASC, created_at ASC
           LIMIT 1`,
        )
        .get(timestamp, ...typeFilter.values) as JobRow | null;
      if (!row) return null;
      const result = database
        .query(
          `UPDATE jobs
           SET state = 'running', attempt = attempt + 1,
               lease_owner = ?1, lease_token = ?2, lease_expires_at = ?3,
               updated_at = ?4
           WHERE id = ?5 AND state = 'queued'`,
        )
        .run(
          claimOptions.workerId,
          leaseToken,
          timestamp + claimOptions.leaseMs,
          timestamp,
          row.id,
        );
      if (result.changes !== 1) return null;
      return rowToJob(requireRow(selectById.get(row.id)));
    });
    const claimed = transaction();
    if (claimed) {
      insertLog.run(
        claimed.id,
        timestamp,
        "info",
        "job.started",
        `Attempt ${claimed.attempt} of ${claimed.maxAttempts}`,
      );
    }
    return claimed;
  }

  return {
    enqueue,

    async get<T = unknown>(id: string) {
      const row = selectById.get(id) as JobRow | null;
      return row ? (rowToJob(row) as DurableJob<T>) : null;
    },

    async list(filter = {}) {
      const stateFilter = queryFilter("state", filter.states, 1);
      const typeFilter = queryFilter(
        "type",
        filter.types,
        stateFilter.values.length + 1,
      );
      const limit = filter.limit ?? 100;
      const offset = filter.offset ?? 0;
      if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1000) {
        throw new TypeError("Job list limit must be from 1 to 1000");
      }
      if (!Number.isSafeInteger(offset) || offset < 0) {
        throw new TypeError("Job list offset must be a non-negative integer");
      }
      const clauses = [stateFilter.sql, typeFilter.sql].filter(Boolean);
      const where = clauses.length ? `WHERE 1 = 1 ${clauses.join(" ")}` : "";
      const rows = database
        .query(
          `SELECT * FROM jobs ${where}
           ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
        )
        .all(...stateFilter.values, ...typeFilter.values) as JobRow[];
      return rows.map(rowToJob);
    },

    async count(filter = {}) {
      const stateFilter = queryFilter("state", filter.states, 1);
      const typeFilter = queryFilter(
        "type",
        filter.types,
        stateFilter.values.length + 1,
      );
      const clauses = [stateFilter.sql, typeFilter.sql].filter(Boolean);
      const where = clauses.length ? `WHERE 1 = 1 ${clauses.join(" ")}` : "";
      const row = database
        .query(`SELECT count(*) AS count FROM jobs ${where}`)
        .get(...stateFilter.values, ...typeFilter.values) as {
        count: number;
      } | null;
      return Number(row?.count ?? 0);
    },

    async logs(id) {
      return database
        .query(
          `SELECT timestamp, level, event, message
           FROM job_logs WHERE job_id = ?1 ORDER BY timestamp ASC, id ASC`,
        )
        .all(id) as JobLogEntry[];
    },

    claim,

    async heartbeat(id, leaseToken, leaseMs, timestamp = now()) {
      if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
        throw new TypeError("leaseMs must be a positive integer");
      }
      const result = database
        .query(
          `UPDATE jobs SET lease_expires_at = ?1, updated_at = ?2
           WHERE id = ?3 AND state = 'running' AND lease_token = ?4`,
        )
        .run(timestamp + leaseMs, timestamp, id, leaseToken);
      if (result.changes !== 1) throw new JobLeaseLostError(id);
    },

    async complete(id, leaseToken, timestamp = now()) {
      const result = database
        .query(
          `UPDATE jobs
           SET state = 'completed', lease_owner = NULL, lease_token = NULL,
               lease_expires_at = NULL, completed_at = ?1, updated_at = ?1
           WHERE id = ?2 AND state = 'running' AND lease_token = ?3`,
        )
        .run(timestamp, id, leaseToken);
      if (result.changes !== 1) throw new JobLeaseLostError(id);
      insertLog.run(id, timestamp, "info", "job.completed", "Completed");
    },

    async fail(id, leaseToken, error, failOptions = {}) {
      const timestamp = failOptions.now ?? now();
      const row = selectById.get(id) as JobRow | null;
      if (!row || row.state !== "running" || row.lease_token !== leaseToken) {
        throw new JobLeaseLostError(id);
      }
      const finalFailure = row.attempt >= row.max_attempts;
      const retryAt =
        failOptions.retryAt ?? timestamp + retryDelayMs(row.attempt);
      const result = database
        .query(
          `UPDATE jobs
           SET state = ?1, run_at = ?2, last_error = ?3,
               lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
               completed_at = ?4, updated_at = ?5
           WHERE id = ?6 AND state = 'running' AND lease_token = ?7`,
        )
        .run(
          finalFailure ? "failed" : "queued",
          finalFailure ? row.run_at : retryAt,
          formatError(error),
          finalFailure ? timestamp : null,
          timestamp,
          id,
          leaseToken,
        );
      if (result.changes !== 1) throw new JobLeaseLostError(id);
      insertLog.run(
        id,
        timestamp,
        finalFailure ? "error" : "warn",
        finalFailure ? "job.failed" : "job.retry_scheduled",
        formatError(error),
      );
    },

    async cancel(id, timestamp = now()) {
      const result = database
        .query(
          `UPDATE jobs
           SET state = 'cancelled', lease_owner = NULL, lease_token = NULL,
               lease_expires_at = NULL, completed_at = ?1, updated_at = ?1
           WHERE id = ?2 AND state IN ('queued', 'running')`,
        )
        .run(timestamp, id);
      if (result.changes === 1) {
        insertLog.run(id, timestamp, "warn", "job.cancelled", "Cancelled");
      }
      return result.changes === 1;
    },

    async requeueExpired(timestamp = now()) {
      return requeueExpiredSync(database, timestamp);
    },

    close() {
      if (ownsDatabase) database.close();
    },
  };
}

function requeueExpiredSync(database: Database, now: number): number {
  const failed = database
    .query(
      `UPDATE jobs
       SET state = 'failed', last_error = COALESCE(last_error, 'worker lease expired'),
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
           completed_at = ?1, updated_at = ?1
       WHERE state = 'running' AND lease_expires_at <= ?1
         AND attempt >= max_attempts`,
    )
    .run(now);
  const queued = database
    .query(
      `UPDATE jobs
       SET state = 'queued', run_at = ?1,
           last_error = COALESCE(last_error, 'worker lease expired'),
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
           updated_at = ?1
       WHERE state = 'running' AND lease_expires_at <= ?1
         AND attempt < max_attempts`,
    )
    .run(now);
  return failed.changes + queued.changes;
}

function rowToJob(row: JobRow): DurableJob {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch (error) {
    throw new Error(`Stored payload for job ${row.id} is invalid JSON`, {
      cause: error,
    });
  }
  return {
    id: row.id,
    type: row.type,
    payload,
    state: row.state,
    dedupeKey: row.dedupe_key,
    priority: row.priority,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    runAt: row.run_at,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function requireRow(row: unknown): JobRow {
  if (!row || typeof row !== "object") {
    throw new Error("Expected persisted job was not found");
  }
  return row as JobRow;
}

function serializePayload(value: unknown): string {
  try {
    const serialized = JSON.stringify(value ?? null);
    if (serialized === undefined)
      throw new TypeError("Payload is not serializable");
    return serialized;
  } catch (error) {
    throw new TypeError("Job payload must be JSON serializable", {
      cause: error,
    });
  }
}

function validateEnqueue(input: EnqueueJob<unknown>): void {
  if (!/^[a-z][a-z0-9._-]{0,99}$/i.test(input.type)) {
    throw new TypeError("Job type is invalid");
  }
  if (input.id !== undefined && !input.id.trim()) {
    throw new TypeError("Job id cannot be empty");
  }
  if (input.dedupeKey !== undefined && !input.dedupeKey.trim()) {
    throw new TypeError("Job dedupe key cannot be empty");
  }
  if (
    input.maxAttempts !== undefined &&
    (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts <= 0)
  ) {
    throw new TypeError("maxAttempts must be a positive integer");
  }
  if (input.priority !== undefined && !Number.isSafeInteger(input.priority)) {
    throw new TypeError("priority must be an integer");
  }
  if (input.runAt !== undefined && !Number.isFinite(input.runAt)) {
    throw new TypeError("runAt must be a finite epoch timestamp");
  }
}

function validateClaim(options: ClaimJobOptions): void {
  if (!options.workerId.trim()) throw new TypeError("workerId is required");
  if (!Number.isSafeInteger(options.leaseMs) || options.leaseMs <= 0) {
    throw new TypeError("leaseMs must be a positive integer");
  }
  for (const type of options.types ?? []) {
    if (!/^[a-z][a-z0-9._-]{0,99}$/i.test(type)) {
      throw new TypeError("Claim contains an invalid job type");
    }
  }
}

function queryFilter(
  column: "state" | "type",
  values: readonly string[] | undefined,
  firstParameter: number,
): { sql: string; values: readonly string[] } {
  if (!values?.length) return { sql: "", values: [] };
  const uniqueValues = [...new Set(values)];
  const placeholders = uniqueValues.map(
    (_, index) => `?${index + firstParameter}`,
  );
  return {
    sql: `AND ${column} IN (${placeholders.join(", ")})`,
    values: uniqueValues,
  };
}

function retryDelayMs(attempt: number): number {
  return Math.min(15 * 60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

function formatError(error: unknown): string {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return redactText(message).slice(0, 4_000);
}

function isObjectPayload(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
