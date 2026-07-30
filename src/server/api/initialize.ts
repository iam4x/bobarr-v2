import type { LibraryItem, LibraryQuery } from "../../contracts";
import type { Clock, Logger } from "../core";
import type { CatalogDetails, TmdbClient } from "../integrations";

import { Database } from "bun:sqlite";
import { dirname, join } from "node:path";

import {
  createAcquisitionRuntime,
  type AcquisitionRuntime,
} from "./acquisition-runtime";
import { createApiApp, type BobarrApi } from "./app";
import {
  createIntegrationResolver,
  type IntegrationResolver,
} from "./integration-resolver";
import {
  ensureMonitoredSeasons,
  seasonUsesEpisodeAcquisition,
} from "./product";
import { AuthService, SecretVault } from "../auth";
import { loadBackendConfig, type BackendConfig } from "../config";
import {
  DEFAULT_GRACEFUL_SHUTDOWN_MS,
  settleByDeadline,
  systemClock,
  createLogger,
} from "../core";
import {
  createRepositories,
  openBackendDatabase,
  type BackendDatabase,
  type Repositories,
} from "../db";
import { aggregateChildAcquisitionState } from "../domain/media-state";
import { createEventHub, type EventHub } from "../events";
import {
  createJobWorker,
  createSqliteJobQueue,
  nextCronOccurrence,
  type JobHandler,
  type JobQueue,
} from "../jobs";
import {
  createBackupRestoreService,
  createSqliteBackup,
  type BackupRestoreService,
} from "../operations";

export interface InitializeBackendOptions {
  config?: BackendConfig;
  environment?: Record<string, string | undefined>;
  clock?: Clock;
  logger?: Logger;
  prepareDownloadDirectory?: (path: string) => Promise<void>;
}

export interface BackendRuntime {
  app: BobarrApi;
  config: BackendConfig;
  database: BackendDatabase;
  repositories: Repositories;
  auth: AuthService;
  secrets: SecretVault;
  queue: JobQueue;
  events: EventHub;
  integrations: IntegrationResolver;
  acquisition: AcquisitionRuntime;
  restore: BackupRestoreService;
  logger: Logger;
  beginShutdown(): void;
  close(
    options?: BackendRuntimeCloseOptions,
  ): Promise<BackendRuntimeCloseResult>;
}

export interface BackendRuntimeCloseOptions {
  /** Absolute epoch deadline shared with the HTTP server shutdown. */
  deadlineAt?: number;
}

export interface BackendRuntimeCloseResult {
  forced: boolean;
}

const FORCED_ABORT_SETTLE_MS = 250;
const MAINTENANCE_PAGE_SIZE = 100;

export async function initializeBackend(
  options: InitializeBackendOptions = {},
): Promise<BackendRuntime> {
  const environment = options.environment ?? process.env;
  const config = options.config ?? (await loadBackendConfig(environment));
  const clock = options.clock ?? systemClock;
  const logger =
    options.logger ??
    createLogger({
      minimumLevel: config.environment === "development" ? "debug" : "info",
      version: config.version,
      ...(config.environment === "test" ? { write: () => undefined } : {}),
    });
  const configDirectory =
    environment["BOBARR_CONFIG_DIR"] ??
    (config.databasePath === ":memory:"
      ? "./config"
      : dirname(config.databasePath));
  const jobsPath =
    environment["BOBARR_JOBS_DATABASE_PATH"] ??
    (config.databasePath === ":memory:"
      ? ":memory:"
      : join(configDirectory, "jobs.sqlite"));
  const backupDirectory =
    environment["BOBARR_BACKUP_DIR"] ?? join(configDirectory, "backups");
  const restore = createBackupRestoreService({
    databasePath: config.databasePath,
    jobsDatabasePath: jobsPath,
    backupDirectory,
  });
  await restore.applyStagedRestore();
  const database = await openBackendDatabase(config.databasePath);
  const queue = createSqliteJobQueue({ database: jobsPath });
  const events = createEventHub();
  let cleanupPartialRuntime: (() => void) | undefined;

  try {
    const repositories = createRepositories(database, clock);
    const secrets = await SecretVault.create(
      config.encryptionKey,
      repositories.secrets,
      clock,
    );
    const auth = await AuthService.create({
      repository: repositories.auth,
      config,
      clock,
      loginLockEnabled: () =>
        repositories.settings.ensureDefaults().settings.security
          .loginLockEnabled,
    });
    const integrations = createIntegrationResolver({
      environment,
      secrets,
      settings: repositories.settings,
    });
    const backup = async () => {
      const retention =
        repositories.settings.ensureDefaults().settings.schedules
          .backupRetention;
      const application = await createSqliteBackup(database.sqlite, {
        directory: backupDirectory,
        prefix: "bobarr",
        retention,
      });
      if (jobsPath === ":memory:") return { application };

      const jobsDatabase = new Database(jobsPath, {
        readonly: true,
        strict: true,
      });
      try {
        const jobs = await createSqliteBackup(jobsDatabase, {
          directory: backupDirectory,
          prefix: "jobs",
          retention,
        });
        return { application, jobs };
      } finally {
        jobsDatabase.close(false);
      }
    };
    const acquisition = createAcquisitionRuntime({
      config,
      database,
      repositories,
      queue,
      events,
      integrations,
      prepareDownloadDirectory: options.prepareDownloadDirectory,
    });
    const maintenanceHandlers: Record<string, JobHandler> = {
      "maintenance.reconcile.v1": async (_job, context) => {
        await acquisition.reconcile(context.signal);
      },
      "maintenance.backup.v1": async () => {
        await backup();
      },
      "maintenance.cleanup.v1": async () => {
        repositories.releases.purgeExpired();
        repositories.metadataCache.purgeExpired();
        repositories.auth.deleteExpiredSessions(clock.now().getTime());
      },
      "maintenance.search-missing.v1": async () => {
        await enqueueMissingMedia(queue, repositories);
      },
      "maintenance.refresh-metadata.v1": async (_job, context) => {
        const tmdb = await integrations.tmdb();
        const settings = repositories.settings.ensureDefaults().settings;
        await refreshAllMetadata({
          repositories,
          queue,
          client: tmdb,
          language: settings.locale.language,
          signal: context.signal,
          heartbeat: context.heartbeat,
        });
        events.publish("library.changed", { reason: "metadata-refreshed" });
      },
    };
    const worker = createJobWorker({
      queue,
      logger,
      handlers: { ...acquisition.handlers, ...maintenanceHandlers },
      retryDelay: (job) =>
        Math.min(60 * 60_000, 5_000 * 2 ** Math.max(0, job.attempt - 1)),
    });
    const workerAbort = new AbortController();
    const backgroundWork = new Set<Promise<unknown>>();
    let shutdownStarted = false;
    let activeWorkerDrain: Promise<void> | null = null;
    const timers: Partial<
      Record<"worker" | "reconcile" | "progress" | "maintenance", Timer>
    > = {};

    const trackBackground = <T>(work: Promise<T>): Promise<T> => {
      backgroundWork.add(work);
      const remove = (): void => {
        backgroundWork.delete(work);
      };
      void work.then(remove, remove);
      return work;
    };
    const runInBackground = (work: Promise<unknown>): void => {
      void trackBackground(work).catch(() => undefined);
    };
    const drainWorker = (): Promise<void> => {
      if (activeWorkerDrain) return activeWorkerDrain;
      if (shutdownStarted || workerAbort.signal.aborted) {
        return Promise.resolve();
      }
      const operation = (async (): Promise<void> => {
        const processed = await worker.drain({
          maxJobs: 10,
          signal: workerAbort.signal,
          shouldContinue: () => !shutdownStarted,
        });
        if (processed > 0) {
          events.publish("snapshot.invalidated", {
            resources: ["jobs", "downloads", "library", "activity"],
          });
        }
      })();
      activeWorkerDrain = trackBackground(operation);
      const clearActiveDrain = (): void => {
        if (activeWorkerDrain === operation) activeWorkerDrain = null;
      };
      void operation.then(clearActiveDrain, clearActiveDrain);
      return operation;
    };
    const stopTimers = (): void => {
      for (const timer of Object.values(timers)) clearInterval(timer);
    };
    cleanupPartialRuntime = (): void => {
      shutdownStarted = true;
      stopTimers();
      workerAbort.abort(
        new DOMException("Backend initialization failed", "AbortError"),
      );
    };

    await queue.requeueExpired();
    await enqueueScheduledMaintenance(queue, repositories);
    try {
      await acquisition.reconcile(workerAbort.signal);
    } catch {
      // Connectors may intentionally be unconfigured on first run.
    }
    const app = createApiApp({
      config,
      database,
      repositories,
      auth,
      secrets,
      queue,
      events,
      integrations,
      acquisition: acquisition.service,
      diagnostics: () => integrations.status(),
      backup,
      restore,
      environment,
      clock,
      logger,
      cancelJob: (id) => worker.cancel(id),
    });
    // Start background work only after repositories, integrations, handlers,
    // and the HTTP application have all been constructed.
    timers.worker = setInterval(
      () => void drainWorker().catch(() => undefined),
      750,
    );
    timers.worker.unref?.();
    timers.reconcile = setInterval(
      () =>
        runInBackground(
          queue.enqueue({
            type: "maintenance.reconcile.v1",
            payload: { version: 1 },
            dedupeKey: "active-downloads",
            maxAttempts: 5,
          }),
        ),
      30_000,
    );
    timers.reconcile.unref?.();
    timers.progress = setInterval(() => {
      if (events.subscribers === 0 || workerAbort.signal.aborted) return;
      runInBackground(acquisition.publishLiveProgress(workerAbort.signal));
    }, 3_000);
    timers.progress.unref?.();
    timers.maintenance = setInterval(
      () => runInBackground(enqueueScheduledMaintenance(queue, repositories)),
      60 * 60_000,
    );
    timers.maintenance.unref?.();
    let resourcesClosed = false;
    let closePromise: Promise<BackendRuntimeCloseResult> | null = null;
    const beginShutdown = (): void => {
      if (shutdownStarted) return;
      shutdownStarted = true;
      stopTimers();
      // Close SSE streams so a graceful HTTP stop is not held open forever.
      events.close();
    };
    const close = (
      closeOptions: BackendRuntimeCloseOptions = {},
    ): Promise<BackendRuntimeCloseResult> => {
      beginShutdown();
      if (closePromise) return closePromise;
      closePromise = (async (): Promise<BackendRuntimeCloseResult> => {
        const deadlineAt =
          closeOptions.deadlineAt ?? Date.now() + DEFAULT_GRACEFUL_SHUTDOWN_MS;
        const pendingWork = [...backgroundWork];
        let forced = false;
        if (pendingWork.length > 0) {
          const gracefulDeadline = Math.max(
            Date.now(),
            deadlineAt - FORCED_ABORT_SETTLE_MS,
          );
          const settlement = await settleByDeadline(
            Promise.allSettled(pendingWork),
            gracefulDeadline,
          );
          forced = !settlement.settled;
          if (forced) {
            workerAbort.abort(
              new DOMException(
                "Graceful shutdown deadline expired",
                "AbortError",
              ),
            );
            await settleByDeadline(Promise.allSettled(pendingWork), deadlineAt);
          }
        }
        if (!workerAbort.signal.aborted) workerAbort.abort();
        if (!resourcesClosed) {
          resourcesClosed = true;
          try {
            queue.close();
          } finally {
            database.close();
          }
        }
        return { forced };
      })();
      return closePromise;
    };
    cleanupPartialRuntime = undefined;
    return {
      app,
      config,
      database,
      repositories,
      auth,
      secrets,
      queue,
      events,
      integrations,
      acquisition,
      restore,
      logger,
      beginShutdown,
      close,
    };
  } catch (error) {
    cleanupPartialRuntime?.();
    events.close();
    queue.close();
    database.close();
    throw error;
  }
}

export async function refreshFutureSeasons(options: {
  parent: LibraryItem;
  details: CatalogDetails;
  repositories: Repositories;
  queue: JobQueue;
  client: TmdbClient;
  language: string;
  signal?: AbortSignal;
}): Promise<LibraryItem[]> {
  const { parent, details, repositories, queue, client, language, signal } =
    options;
  if (parent.kind !== "series") return [];
  const currentSeasons = repositories.media
    .children(parent.id)
    .filter(
      (child): child is typeof child & { seasonNumber: number } =>
        child.kind === "season" &&
        child.seasonNumber !== null &&
        child.monitorPolicy !== "none",
    );
  const currentSeasonNumbers = currentSeasons.map(
    (season) => season.seasonNumber,
  );
  const changedCurrentSeasons = await ensureMonitoredSeasons({
    parent,
    seasonNumbers: currentSeasonNumbers,
    dependencies: { repositories },
    client,
    language,
    signal,
  });
  for (const season of changedCurrentSeasons) {
    const children = repositories.media.children(season.id);
    await enqueueSeasonDefault(queue, season, children);
    repositories.media.updateState(
      season.id,
      aggregateChildAcquisitionState(children),
    );
  }
  if (changedCurrentSeasons.length > 0) {
    repositories.media.updateState(
      parent.id,
      aggregateChildAcquisitionState(repositories.media.children(parent.id)),
    );
  }

  if (parent.metadata["includeFutureSeasons"] !== true) {
    return changedCurrentSeasons;
  }
  const latestMonitoredSeason = Math.max(0, ...currentSeasonNumbers);
  const availableSeasons = details.numberOfSeasons ?? 0;
  const storedFutureBaseline = parent.metadata["futureSeasonsAfter"];
  const futureBaseline =
    typeof storedFutureBaseline === "number" &&
    Number.isSafeInteger(storedFutureBaseline) &&
    storedFutureBaseline >= 0
      ? storedFutureBaseline
      : null;
  let firstFutureSeason = availableSeasons;
  if (futureBaseline !== null) {
    firstFutureSeason = futureBaseline + 1;
  } else if (latestMonitoredSeason > 0) {
    firstFutureSeason = latestMonitoredSeason + 1;
  }
  const futureSeasonNumbers =
    firstFutureSeason > 0 && availableSeasons >= firstFutureSeason
      ? Array.from(
          { length: availableSeasons - firstFutureSeason + 1 },
          (_, index) => firstFutureSeason + index,
        )
      : [];
  const newSeasons = await ensureMonitoredSeasons({
    parent,
    seasonNumbers: futureSeasonNumbers,
    dependencies: { repositories },
    client,
    language,
    signal,
  });
  for (const season of newSeasons) {
    await enqueueSeasonDefault(
      queue,
      season,
      repositories.media.children(season.id),
    );
  }
  if (newSeasons.length > 0) {
    repositories.media.updateState(
      parent.id,
      aggregateChildAcquisitionState(repositories.media.children(parent.id)),
    );
  }
  return [...changedCurrentSeasons, ...newSeasons];
}

async function enqueueScheduledMaintenance(
  queue: JobQueue,
  repositories: Repositories,
): Promise<void> {
  const now = Date.now();
  const settings = repositories.settings.ensureDefaults().settings;
  const schedules = [
    {
      type: "maintenance.search-missing.v1",
      expression: settings.schedules.searchMissing,
      payload: { version: 1 },
    },
    {
      type: "maintenance.refresh-metadata.v1",
      expression: settings.schedules.refreshMetadata,
      payload: { version: 1 },
    },
    {
      type: "library.scan.v1",
      expression: settings.schedules.scanLibrary,
      payload: {
        version: 1,
        roots: [settings.storage.moviesPath, settings.storage.televisionPath],
      },
    },
    {
      type: "maintenance.backup.v1",
      expression: settings.schedules.backup,
      payload: { version: 1 },
    },
    {
      type: "maintenance.cleanup.v1",
      expression: "15 5 * * *",
      payload: { version: 1 },
    },
  ];
  for (const schedule of schedules) {
    const runAt = nextCronOccurrence(
      schedule.expression,
      new Date(now),
    ).getTime();
    await queue.enqueue({
      type: schedule.type,
      payload: schedule.payload,
      dedupeKey: String(runAt),
      runAt,
      maxAttempts: 3,
    });
  }
}

export async function enqueueMissingMedia(
  queue: JobQueue,
  repositories: Repositories,
): Promise<void> {
  const missing = snapshotMediaItems(repositories, { status: "missing" });
  for (const media of missing) {
    const supportsScheduledAcquisition =
      media.kind === "movie" ||
      (media.kind === "season" && !seasonUsesEpisodeAcquisition(media)) ||
      (media.kind === "episode" &&
        media.metadata["incrementalAcquisition"] === true);
    if (
      media.monitorPolicy === "none" ||
      media.metadata["manualSearchPending"] === true ||
      !supportsScheduledAcquisition
    ) {
      continue;
    }
    await queue.enqueue({
      type: "media.acquire.v1",
      payload: { version: 1, mediaId: media.id },
      dedupeKey: media.id,
      ...(media.kind === "episode"
        ? {
            runAt: Math.max(
              Date.now(),
              media.releaseDate ? Date.parse(media.releaseDate) : Date.now(),
            ),
          }
        : {}),
      maxAttempts: 5,
    });
  }
}

async function enqueueSeasonDefault(
  queue: JobQueue,
  season: LibraryItem,
  episodes: readonly LibraryItem[],
): Promise<void> {
  if (!seasonUsesEpisodeAcquisition(season)) {
    if (["missing", "failed"].includes(season.acquisitionState)) {
      await queue.enqueue({
        type: "media.acquire.v1",
        payload: { version: 1, mediaId: season.id },
        dedupeKey: season.id,
        maxAttempts: 5,
      });
    }
    return;
  }

  for (let offset = 0; ; offset += 1_000) {
    const jobs = await queue.list({
      states: ["queued", "running"],
      types: ["media.acquire.v1"],
      limit: 1_000,
      offset,
    });
    for (const job of jobs) {
      if (
        typeof job.payload === "object" &&
        job.payload !== null &&
        "mediaId" in job.payload &&
        job.payload.mediaId === season.id
      ) {
        await queue.cancel(job.id);
      }
    }
    if (jobs.length < 1_000) break;
  }

  for (const episode of episodes) {
    if (
      episode.kind !== "episode" ||
      episode.monitorPolicy === "none" ||
      !["missing", "failed"].includes(episode.acquisitionState)
    ) {
      continue;
    }
    const parsedReleaseAt = episode.releaseDate
      ? Date.parse(episode.releaseDate)
      : Date.now();
    const releaseAt = Number.isFinite(parsedReleaseAt)
      ? parsedReleaseAt
      : Date.now();
    await queue.enqueue({
      type: "media.acquire.v1",
      payload: { version: 1, mediaId: episode.id },
      dedupeKey: episode.id,
      runAt: Math.max(Date.now(), releaseAt),
      maxAttempts: 5,
    });
  }
}

export async function refreshAllMetadata(options: {
  repositories: Repositories;
  queue: JobQueue;
  client: TmdbClient;
  language: string;
  signal: AbortSignal;
  heartbeat(): Promise<void>;
}): Promise<void> {
  for (const kind of ["movie", "series"] as const) {
    // Updating metadata changes updatedAt, which is also the list sort key. Take
    // the complete snapshot before writing so offset pagination cannot skip or
    // repeat records as they move through the result set.
    const items = snapshotMediaItems(options.repositories, { kind });
    for (const item of items) {
      if (!item.tmdbId) continue;
      options.signal.throwIfAborted();
      const details = await options.client.details(
        kind === "movie" ? "movie" : "tv",
        item.tmdbId,
        {
          language: options.language,
          signal: options.signal,
        },
      );
      options.repositories.media.updateMetadata(item.id, {
        title: details.title,
        year: details.year,
        posterUrl: details.posterPath
          ? `https://image.tmdb.org/t/p/w500/${details.posterPath.replace(/^\//, "")}`
          : null,
        releaseDate: details.releaseDate
          ? new Date(`${details.releaseDate}T00:00:00.000Z`).toISOString()
          : null,
        metadata: {
          ...item.metadata,
          overview: details.overview,
          backdropPath: details.backdropPath,
          genres: details.genres,
          voteAverage: details.voteAverage,
          voteCount: details.voteCount,
          numberOfSeasons: details.numberOfSeasons,
          numberOfEpisodes: details.numberOfEpisodes,
        },
      });
      if (kind === "series") {
        await refreshFutureSeasons({
          parent: item,
          details,
          repositories: options.repositories,
          queue: options.queue,
          client: options.client,
          language: options.language,
          signal: options.signal,
        });
      }
      await options.heartbeat();
    }
  }
}

function snapshotMediaItems(
  repositories: Repositories,
  filters: Omit<LibraryQuery, "limit" | "offset">,
): LibraryItem[] {
  const snapshot: LibraryItem[] = [];
  let offset = 0;
  while (true) {
    const page = repositories.media.list({
      ...filters,
      limit: MAINTENANCE_PAGE_SIZE,
      offset,
    });
    snapshot.push(...page.items);
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) break;
  }
  return snapshot;
}
