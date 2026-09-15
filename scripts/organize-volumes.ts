import type { VolumeOrganizationProgress } from "../src/server/library/volume-organizer";

import { Database } from "bun:sqlite";
import { lstat, open, readlink, unlink } from "node:fs/promises";
import { join } from "node:path";

import { createIntegrationResolver } from "../src/server/api/integration-resolver";
import { SecretVault } from "../src/server/auth";
import { loadBackendConfig } from "../src/server/config";
import { createRepositories, openBackendDatabase } from "../src/server/db";
import {
  activeVolumeTransfers,
  VolumeTransferSchema,
} from "../src/server/db/volume-transfers";
import { createVolumeOrganizer } from "../src/server/library/volume-organizer";

const mode = process.argv[2] ?? "--inspect";
const remaining = process.argv.slice(3);
if (mode === "--help" || mode === "-h") {
  process.stdout.write(
    "Usage: bun scripts/organize-volumes.ts [--inspect|--resume-only|--run [--max-groups N]]\n" +
      "  --inspect  Read active transfers and file identities without writing. Default.\n" +
      "  --resume-only  Finish active transfers without starting new groups.\n" +
      "  --run      Resume transfers and organize volumes. --max-groups limits new moves.\n" +
      "Stop the Bobarr server before --resume-only or --run.\n" +
      "Output is JSON Lines; pipe it through tee to keep a log.\n",
  );
  process.exit(0);
}
if (!["--inspect", "--resume-only", "--run"].includes(mode))
  throw new TypeError("Use --inspect, --resume-only, --run, or --help");
if (mode !== "--run" && remaining.length > 0)
  throw new TypeError(`${mode} does not accept extra arguments`);
let maxNewGroups: number | undefined;
if (mode === "--resume-only") maxNewGroups = 0;
if (mode === "--run" && remaining.length > 0) {
  if (remaining.length !== 2 || remaining[0] !== "--max-groups")
    throw new TypeError("Use --run --max-groups N with a positive integer N");
  const limit = Number(remaining[1]);
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new TypeError("--max-groups requires a positive integer");
  maxNewGroups = limit;
}

const configDirectory = process.env["BOBARR_CONFIG_DIR"] ?? "./config";
const databasePath =
  process.env["BOBARR_DATABASE_PATH"] ?? join(configDirectory, "bobarr.sqlite");
if (!(await Bun.file(databasePath).exists()))
  throw new Error(`Bobarr database does not exist: ${databasePath}`);

const emit = (event: Record<string, unknown>): void => {
  process.stdout.write(
    `${JSON.stringify(
      { timestamp: new Date().toISOString(), ...event },
      (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
    )}\n`,
  );
};

if (mode === "--inspect") {
  const database = new Database(databasePath, { readonly: true, strict: true });
  try {
    const rows = database
      .query<{ manifest_json: string }, []>(
        "SELECT manifest_json FROM volume_transfers WHERE stage <> 'complete' ORDER BY created_at, id",
      )
      .all();
    emit({ event: "inspect.start", activeTransfers: rows.length });
    for (const row of rows) {
      const transfer = VolumeTransferSchema.parse(
        JSON.parse(row.manifest_json),
      );
      emit({
        event: "inspect.transfer",
        transferId: transfer.id,
        title: transfer.title,
        stage: transfer.stage,
        destinationVolumeId: transfer.destinationVolumeId,
        files: transfer.files.length,
        downloads: transfer.downloads.length,
      });
      for (const file of transfer.files) {
        const source = await lstat(file.source).catch((error: unknown) => {
          if (isMissing(error)) return null;
          throw error;
        });
        const retirement = await lstat(file.retirementPath).catch(
          (error: unknown) => {
            if (isMissing(error)) return null;
            throw error;
          },
        );
        const destination = await lstat(file.destination).catch(
          (error: unknown) => {
            if (isMissing(error)) return null;
            throw error;
          },
        );
        const original = retirement ?? source;
        const link = original?.isSymbolicLink()
          ? await readlink(retirement ? file.retirementPath : file.source)
          : null;
        const identity = original
          ? {
              dev: original.dev,
              ino: original.ino,
              size: original.size,
              mtimeMs: original.mtimeMs,
              link,
            }
          : null;
        const changed =
          identity !== null &&
          (identity.dev !== file.identity.dev ||
            identity.ino !== file.identity.ino ||
            identity.size !== file.identity.size ||
            identity.mtimeMs !== file.identity.mtimeMs ||
            identity.link !== file.identity.link);
        let sourceState: "changed" | "unchanged" | "missing" = "missing";
        if (original) sourceState = changed ? "changed" : "unchanged";
        emit({
          event: "inspect.file",
          transferId: transfer.id,
          source: file.source,
          retirementPath: retirement ? file.retirementPath : null,
          destination: file.destination,
          sourceState,
          destinationState: destination ? "present" : "missing",
          expectedIdentity: changed ? file.identity : undefined,
          actualIdentity: changed ? identity : undefined,
          retainedStagingPaths: file.retainedStagingPaths,
        });
      }
    }
    emit({ event: "inspect.complete" });
  } finally {
    database.close(false);
  }
} else {
  await assertBobarrStopped();
  const lockPath = join(configDirectory, ".bobarr-volume-organize-cli.lock");
  const lock = await open(lockPath, "wx", 0o600).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new Error(
        `Organizer CLI lock already exists: ${lockPath}. Check for another running CLI before retrying.`,
      );
    throw error;
  });
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    await lock.sync();
    const config = await loadBackendConfig();
    if (config.databasePath !== databasePath)
      throw new Error("CLI and backend database paths differ");
    const database = await openBackendDatabase(databasePath);
    const abort = new AbortController();
    const stop = (): void => abort.abort(new Error("CLI interrupted"));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      const repositories = createRepositories(database);
      const secrets = await SecretVault.create(
        config.encryptionKey,
        repositories.secrets,
      );
      const integrations = createIntegrationResolver({
        environment: process.env,
        secrets,
        settings: repositories.settings,
      });
      const transfers = activeVolumeTransfers(database);
      emit({
        event: "run.start",
        databasePath,
        activeTransfers: transfers.length,
        maxNewGroups,
        volumes: repositories.settings
          .ensureDefaults()
          .settings.storage.volumes.map((volume) => ({
            id: volume.id,
            label: volume.label,
          })),
      });
      const lastCopyLog = new Map<string, number>();
      const startedAt = Date.now();
      let lastProgressAt = startedAt;
      let currentEvent = "run.start";
      let currentSource: string | null = null;
      const progress = (update: VolumeOrganizationProgress): void => {
        if (
          update.kind === "transfer" &&
          update.event.kind === "copy-progress"
        ) {
          const key = `${update.event.transferId}:${update.event.source}`;
          const now = Date.now();
          if (
            update.event.bytesCopied < update.event.totalBytes &&
            now - (lastCopyLog.get(key) ?? 0) < 5_000
          )
            return;
          lastCopyLog.set(key, now);
        }
        lastProgressAt = Date.now();
        if (update.kind === "transfer") {
          currentEvent =
            update.event.kind === "file"
              ? `run.transfer.file:${update.event.action}`
              : `run.transfer.${update.event.kind}`;
          currentSource =
            update.event.kind === "file" ||
            update.event.kind === "copy-progress"
              ? update.event.source
              : null;
          emit({ event: `run.transfer.${update.event.kind}`, ...update.event });
        } else {
          currentEvent = `run.${update.kind}`;
          currentSource = null;
          emit({ event: currentEvent, ...update });
        }
      };
      const heartbeatTimer = setInterval(() => {
        const now = Date.now();
        emit({
          event: "run.heartbeat",
          elapsedSeconds: Math.floor((now - startedAt) / 1_000),
          secondsSinceProgress: Math.floor((now - lastProgressAt) / 1_000),
          currentEvent,
          currentSource,
        });
      }, 15_000);
      heartbeatTimer.unref?.();
      try {
        await createVolumeOrganizer({
          database,
          repositories,
          integrations,
        }).organize({
          jobId: `cli:${crypto.randomUUID()}`,
          signal: abort.signal,
          heartbeat: async () => undefined,
          progress,
          retainChangedCommittedSources: true,
          maxNewGroups,
        });
      } finally {
        clearInterval(heartbeatTimer);
      }
      emit({ event: "run.success" });
    } catch (error) {
      emit({
        event: "run.failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      database.close();
    }
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function assertBobarrStopped(): Promise<void> {
  const port = Number(process.env["PORT"] ?? "3000");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new TypeError("PORT must be a valid TCP port for the offline check");
  for (const url of [
    `http://bobarr:${port}/health/live`,
    `http://127.0.0.1:${port}/health/live`,
  ]) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1_500) });
    } catch (error) {
      if (error instanceof TypeError) continue;
      throw new Error(`Could not confirm Bobarr is stopped at ${url}`, {
        cause: error,
      });
    }
    throw new Error(
      `Bobarr is reachable at ${url}; stop it before running the organizer`,
    );
  }
}
