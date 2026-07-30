import type { AcquisitionService } from "../application";
import type { AuthenticatedRequest, AuthService, SecretVault } from "../auth";
import type { BackendConfig } from "../config";
import type { Clock, Logger } from "../core";
import type { BackendDatabase, Repositories } from "../db";
import type { EventHub } from "../events";
import type { JobQueue } from "../jobs";
import type { BackupRestoreService } from "../operations";
import type {
  IntegrationKey,
  IntegrationResolver,
} from "./integration-resolver";
import type { MiddlewareHandler } from "hono";

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";

import { registerBackupRestoreRoutes } from "./backup-restore";
import { withLiveDownloadProgress } from "./live-download-progress";
import { finalizeOpenApiDocument } from "./openapi-contract";
import { registerProductRoutes } from "./product";
import { requestBodyLimitMiddleware } from "./request-body-limit";
import { registerScanReviewRoutes } from "./scan-reviews";
import {
  ApiErrorEnvelopeSchema,
  AppSettingsSchema,
  type AppSettings,
  AuthSessionSchema,
  CalendarListResponseSchema,
  CalendarQuerySchema,
  CreateCalendarEventRequestSchema,
  CreateJobRequestSchema,
  CreateLibraryItemRequestSchema,
  CurrentSessionSchema,
  DeleteLibraryItemResponseSchema,
  DeleteSecretResponseSchema,
  JobParamsSchema,
  JobSchema,
  JobsListResponseSchema,
  JobsQuerySchema,
  JobDetailsSchema,
  LibraryItemParamsSchema,
  LibraryItemSchema,
  LibraryListResponseSchema,
  LibraryQuerySchema,
  LoginRequestSchema,
  LogoutResponseSchema,
  ResetLoginLockResponseSchema,
  SecretListResponseSchema,
  SecretMetadataSchema,
  SecretParamsSchema,
  SetSecretRequestSchema,
  type IntegrationStatus,
  SetupRequestSchema,
  SetupStatusSchema,
  SystemStatusSchema,
  UpdateSettingsRequestSchema,
  UpdateAdminCredentialsRequestSchema,
  UpdateAdminCredentialsResponseSchema,
} from "../../contracts";
import { AppError, notFound, systemClock } from "../core";
import { durableJobToContract, validateCronExpression } from "../jobs";

interface ApiVariables {
  requestId: string;
  auth: AuthenticatedRequest;
}

const REQUIRED_INTEGRATIONS = new Set<IntegrationKey>([
  "tmdb",
  "jackett",
  "transmission",
]);

export interface ApiEnvironment {
  Variables: ApiVariables;
}

export interface ApiDependencies {
  config: BackendConfig;
  database: BackendDatabase;
  repositories: Repositories;
  auth: AuthService;
  secrets: SecretVault;
  queue?: JobQueue;
  events?: EventHub;
  diagnostics?: () => Promise<IntegrationStatus[]>;
  integrations?: IntegrationResolver;
  acquisition?: () => Promise<AcquisitionService>;
  backup?: () => Promise<unknown>;
  restore?: BackupRestoreService;
  environment?: Record<string, string | undefined>;
  clock?: Clock;
  logger: Logger;
  cancelJob?: (id: string) => Promise<boolean>;
}

const errorResponse = {
  content: { "application/json": { schema: ApiErrorEnvelopeSchema } },
  description: "Standard API error",
} as const;

function jsonResponse<TSchema extends z.ZodType>(
  schema: TSchema,
  description: string,
) {
  return {
    content: { "application/json": { schema } },
    description,
  } as const;
}

function jsonBody<TSchema extends z.ZodType>(schema: TSchema) {
  return {
    required: true,
    content: { "application/json": { schema } },
  } as const;
}

function libraryCardRating(metadata: Record<string, unknown>) {
  const value = metadata["voteAverage"];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 10
  ) {
    return null;
  }
  const storedVotes = metadata["voteCount"];
  const votes =
    typeof storedVotes === "number" &&
    Number.isSafeInteger(storedVotes) &&
    storedVotes >= 0
      ? storedVotes
      : null;
  return { source: "tmdb" as const, value, votes };
}

function isLibraryCardActiveDownloadState(state: string): boolean {
  return ["queued", "downloading", "paused", "checking", "organizing"].includes(
    state,
  );
}

const routes = {
  setupStatus: createRoute({
    method: "get",
    path: "/api/v1/setup/status",
    tags: ["setup"],
    responses: {
      200: jsonResponse(SetupStatusSchema, "First-run setup status"),
      default: errorResponse,
    },
  }),
  setup: createRoute({
    method: "post",
    path: "/api/v1/setup",
    tags: ["setup"],
    request: { body: jsonBody(SetupRequestSchema) },
    responses: {
      201: jsonResponse(AuthSessionSchema, "Created administrator session"),
      default: errorResponse,
    },
  }),
  login: createRoute({
    method: "post",
    path: "/api/v1/auth/login",
    tags: ["auth"],
    request: { body: jsonBody(LoginRequestSchema) },
    responses: {
      200: jsonResponse(
        AuthSessionSchema,
        "Authenticated administrator session",
      ),
      default: errorResponse,
    },
  }),
  me: createRoute({
    method: "get",
    path: "/api/v1/auth/me",
    tags: ["auth"],
    security: [{ sessionCookie: [] }],
    responses: {
      200: jsonResponse(CurrentSessionSchema, "Current administrator session"),
      default: errorResponse,
    },
  }),
  logout: createRoute({
    method: "post",
    path: "/api/v1/auth/logout",
    tags: ["auth"],
    security: [{ sessionCookie: [] }],
    responses: {
      200: jsonResponse(LogoutResponseSchema, "Revoked current session"),
      default: errorResponse,
    },
  }),
  getSettings: createRoute({
    method: "get",
    path: "/api/v1/settings",
    tags: ["settings"],
    security: [{ sessionCookie: [] }],
    responses: {
      200: jsonResponse(AppSettingsSchema, "Application settings"),
      default: errorResponse,
    },
  }),
  updateSettings: createRoute({
    method: "patch",
    path: "/api/v1/settings",
    tags: ["settings"],
    security: [{ sessionCookie: [] }],
    request: { body: jsonBody(UpdateSettingsRequestSchema) },
    responses: {
      200: jsonResponse(AppSettingsSchema, "Updated application settings"),
      default: errorResponse,
    },
  }),
  resetLoginLock: createRoute({
    method: "post",
    path: "/api/v1/settings/security/login-lock/reset",
    tags: ["settings"],
    security: [{ sessionCookie: [] }],
    responses: {
      200: jsonResponse(
        ResetLoginLockResponseSchema,
        "Cleared administrator sign-in failures and temporary locks",
      ),
      default: errorResponse,
    },
  }),
  updateAdminCredentials: createRoute({
    method: "patch",
    path: "/api/v1/settings/security/admin",
    tags: ["settings"],
    security: [{ sessionCookie: [] }],
    request: { body: jsonBody(UpdateAdminCredentialsRequestSchema) },
    responses: {
      200: jsonResponse(
        UpdateAdminCredentialsResponseSchema,
        "Updated administrator sign-in credentials",
      ),
      default: errorResponse,
    },
  }),
  listSecrets: createRoute({
    method: "get",
    path: "/api/v1/settings/secrets",
    tags: ["settings"],
    security: [{ sessionCookie: [] }],
    responses: {
      200: jsonResponse(
        SecretListResponseSchema,
        "Configured secret names (never values)",
      ),
      default: errorResponse,
    },
  }),
  setSecret: createRoute({
    method: "put",
    path: "/api/v1/settings/secrets/{name}",
    tags: ["settings"],
    security: [{ sessionCookie: [] }],
    request: {
      params: SecretParamsSchema,
      body: jsonBody(SetSecretRequestSchema),
    },
    responses: {
      200: jsonResponse(
        SecretMetadataSchema,
        "Stored encrypted secret metadata",
      ),
      default: errorResponse,
    },
  }),
  deleteSecret: createRoute({
    method: "delete",
    path: "/api/v1/settings/secrets/{name}",
    tags: ["settings"],
    security: [{ sessionCookie: [] }],
    request: { params: SecretParamsSchema },
    responses: {
      200: jsonResponse(DeleteSecretResponseSchema, "Secret deletion status"),
      default: errorResponse,
    },
  }),
  system: createRoute({
    method: "get",
    path: "/api/v1/system",
    tags: ["system"],
    security: [{ sessionCookie: [] }],
    responses: {
      200: jsonResponse(SystemStatusSchema, "Runtime and persistence status"),
      default: errorResponse,
    },
  }),
  listLibrary: createRoute({
    method: "get",
    path: "/api/v1/library",
    tags: ["library"],
    security: [{ sessionCookie: [] }],
    request: { query: LibraryQuerySchema },
    responses: {
      200: jsonResponse(LibraryListResponseSchema, "Library page"),
      default: errorResponse,
    },
  }),
  createLibrary: createRoute({
    method: "post",
    path: "/api/v1/library",
    tags: ["library"],
    security: [{ sessionCookie: [] }],
    request: { body: jsonBody(CreateLibraryItemRequestSchema) },
    responses: {
      200: jsonResponse(LibraryItemSchema, "Updated monitored library item"),
      201: jsonResponse(LibraryItemSchema, "Created library item"),
      default: errorResponse,
    },
  }),
  getLibrary: createRoute({
    method: "get",
    path: "/api/v1/library/{id}",
    tags: ["library"],
    security: [{ sessionCookie: [] }],
    request: { params: LibraryItemParamsSchema },
    responses: {
      200: jsonResponse(LibraryItemSchema, "Library item"),
      default: errorResponse,
    },
  }),
  deleteLibrary: createRoute({
    method: "delete",
    path: "/api/v1/library/{id}",
    tags: ["library"],
    security: [{ sessionCookie: [] }],
    request: { params: LibraryItemParamsSchema },
    responses: {
      200: jsonResponse(
        DeleteLibraryItemResponseSchema,
        "Library deletion status",
      ),
      default: errorResponse,
    },
  }),
  listCalendar: createRoute({
    method: "get",
    path: "/api/v1/calendar",
    tags: ["calendar"],
    security: [{ sessionCookie: [] }],
    request: { query: CalendarQuerySchema },
    responses: {
      200: jsonResponse(
        CalendarListResponseSchema,
        "Events in an inclusive date range",
      ),
      default: errorResponse,
    },
  }),
  createCalendar: createRoute({
    method: "post",
    path: "/api/v1/calendar",
    tags: ["calendar"],
    security: [{ sessionCookie: [] }],
    request: { body: jsonBody(CreateCalendarEventRequestSchema) },
    responses: {
      201: jsonResponse(
        CalendarListResponseSchema.shape.events.element,
        "Created calendar event",
      ),
      default: errorResponse,
    },
  }),
  listJobs: createRoute({
    method: "get",
    path: "/api/v1/jobs",
    tags: ["jobs"],
    security: [{ sessionCookie: [] }],
    request: { query: JobsQuerySchema },
    responses: {
      200: jsonResponse(JobsListResponseSchema, "Persisted job state page"),
      default: errorResponse,
    },
  }),
  createJob: createRoute({
    method: "post",
    path: "/api/v1/jobs",
    tags: ["jobs"],
    security: [{ sessionCookie: [] }],
    request: { body: jsonBody(CreateJobRequestSchema) },
    responses: {
      202: jsonResponse(JobSchema, "Accepted job record"),
      default: errorResponse,
    },
  }),
  getJob: createRoute({
    method: "get",
    path: "/api/v1/jobs/{id}",
    tags: ["jobs"],
    security: [{ sessionCookie: [] }],
    request: { params: JobParamsSchema },
    responses: {
      200: jsonResponse(JobDetailsSchema, "Persisted job state and log"),
      default: errorResponse,
    },
  }),
  retryJob: createRoute({
    method: "post",
    path: "/api/v1/jobs/{id}/retry",
    tags: ["jobs"],
    security: [{ sessionCookie: [] }],
    request: { params: JobParamsSchema },
    responses: {
      202: jsonResponse(JobSchema, "Retried job record"),
      default: errorResponse,
    },
  }),
  cancelJob: createRoute({
    method: "delete",
    path: "/api/v1/jobs/{id}",
    tags: ["jobs"],
    security: [{ sessionCookie: [] }],
    request: { params: JobParamsSchema },
    responses: {
      200: jsonResponse(
        z.object({ id: z.string().uuid(), cancelled: z.literal(true) }),
        "Cancelled job",
      ),
      default: errorResponse,
    },
  }),
} as const;

export function createApiApp(
  dependencies: ApiDependencies,
): OpenAPIHono<ApiEnvironment> {
  const clock = dependencies.clock ?? systemClock;
  const app = new OpenAPIHono<ApiEnvironment>({
    defaultHook: (result, context) => {
      if (result.success) return;
      const requestId = context.get("requestId") || crypto.randomUUID();
      return context.json(
        {
          error: {
            code: "validation_failed" as const,
            message: "Request validation failed",
            fieldErrors: issuesToFieldErrors(result.error.issues),
            requestId,
          },
        },
        422,
      );
    },
  });

  app.use("*", cors());
  app.use("*", requestContextMiddleware(dependencies));
  app.use("/api/v1/*", authenticationMiddleware(dependencies));
  app.use("/api/v1/*", requestBodyLimitMiddleware());
  app.openAPIRegistry.registerComponent("securitySchemes", "sessionCookie", {
    type: "apiKey",
    in: "cookie",
    name: dependencies.config.sessionCookieName,
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "csrfToken", {
    type: "apiKey",
    in: "header",
    name: "x-csrf-token",
    description:
      "CSRF token returned with the authenticated session; required together with the session cookie for mutations.",
  });

  app.openapi(routes.setupStatus, (context) =>
    context.json({ setupRequired: !dependencies.auth.isSetupComplete() }, 200),
  );
  app.openapi(routes.setup, async (context) => {
    const grant = await dependencies.auth.setup(
      context.req.valid("json"),
      requestMetadata(context.req.raw),
    );
    setSessionCookie(context, dependencies.config, grant.sessionToken);
    setCsrfCookie(context, dependencies.config, grant.response.csrfToken);
    return context.json(grant.response, 201);
  });
  app.openapi(routes.login, async (context) => {
    const grant = await dependencies.auth.login(
      context.req.valid("json"),
      requestMetadata(context.req.raw),
    );
    setSessionCookie(context, dependencies.config, grant.sessionToken);
    setCsrfCookie(context, dependencies.config, grant.response.csrfToken);
    return context.json(grant.response, 200);
  });
  app.openapi(routes.me, (context) => {
    const csrfToken = getCookie(context, csrfCookieName(dependencies.config));
    return context.json(
      {
        ...context.get("auth").current,
        ...(csrfToken === undefined ? {} : { csrfToken }),
      },
      200,
    );
  });
  app.openapi(routes.logout, (context) => {
    dependencies.auth.logout(context.get("auth").sessionId);
    deleteCookie(context, dependencies.config.sessionCookieName, { path: "/" });
    deleteCookie(context, csrfCookieName(dependencies.config), { path: "/" });
    return context.json({ loggedOut: true as const }, 200);
  });
  app.openapi(routes.getSettings, (context) =>
    context.json(
      withoutSecretInputs(
        dependencies.repositories.settings.ensureDefaults().settings,
      ),
      200,
    ),
  );
  app.openapi(routes.updateSettings, async (context) => {
    const patch = context.req.valid("json");
    validateSchedulePatch(patch);
    await persistSecretInputs(dependencies.secrets, patch);
    const updated = dependencies.repositories.settings.update(
      withoutSecretInputs(patch),
    );
    notifyIntegrationConfigurationChanged(
      dependencies,
      integrationKeysForSettings(patch),
    );
    return context.json(withoutSecretInputs(updated.settings), 200);
  });
  app.openapi(routes.resetLoginLock, (context) => {
    dependencies.auth.resetLoginLock(context.get("auth").adminId);
    return context.json({ reset: true as const }, 200);
  });
  app.openapi(routes.updateAdminCredentials, async (context) => {
    const result = await dependencies.auth.updateAdminCredentials(
      context.get("auth").adminId,
      context.req.valid("json"),
    );
    return context.json(result, 200);
  });
  app.openapi(routes.listSecrets, (context) =>
    context.json({ secrets: dependencies.secrets.list() }, 200),
  );
  app.openapi(routes.setSecret, async (context) => {
    const { name } = context.req.valid("param");
    const { value } = context.req.valid("json");
    const metadata = await dependencies.secrets.set(name, value);
    notifyIntegrationConfigurationChanged(
      dependencies,
      integrationKeysForSecret(name),
    );
    return context.json(metadata, 200);
  });
  app.openapi(routes.deleteSecret, (context) => {
    const { name } = context.req.valid("param");
    const deleted = dependencies.secrets.delete(name);
    if (deleted) {
      notifyIntegrationConfigurationChanged(
        dependencies,
        integrationKeysForSecret(name),
      );
    }
    return context.json({ deleted }, 200);
  });
  app.openapi(routes.system, async (context) => {
    let healthy = true;
    try {
      dependencies.database.sqlite.query("SELECT 1").get();
    } catch {
      healthy = false;
    }
    const integrations = (await dependencies.diagnostics?.()) ?? [];
    const queuedJobs =
      dependencies.queue === undefined
        ? dependencies.repositories.jobs.count("queued")
        : await dependencies.queue.count({ states: ["queued", "running"] });
    const failedJobs =
      dependencies.queue === undefined
        ? dependencies.repositories.jobs.count("failed")
        : await dependencies.queue.count({ states: ["failed"] });
    const degraded = integrations.some(
      (integration) =>
        !integration.healthy &&
        (integration.configured ||
          REQUIRED_INTEGRATIONS.has(integration.key as IntegrationKey)),
    );
    let status: "ready" | "degraded" | "unavailable" = "ready";
    if (!healthy) status = "unavailable";
    else if (degraded) status = "degraded";
    return context.json(
      {
        status,
        version: dependencies.config.version,
        environment: dependencies.config.environment,
        integrations,
        database: {
          healthy,
          migrationVersion: dependencies.database.migrationVersion,
        },
        setupComplete: dependencies.auth.isSetupComplete(),
        counts: {
          libraryItems: dependencies.repositories.library.count(),
          queuedJobs,
          failedJobs,
        },
        now: clock.now().toISOString(),
      },
      200,
    );
  });
  // Static scan-review paths must be registered before `/library/{id}`.
  registerScanReviewRoutes(app, dependencies);
  app.openapi(routes.listLibrary, async (context) => {
    const query = context.req.valid("query");
    const result = dependencies.repositories.library.list(query);
    const summary = dependencies.repositories.library.summarize({
      ...(query.kind === undefined ? {} : { kind: query.kind }),
      ...(query.parentId === undefined ? {} : { parentId: query.parentId }),
      ...(query.monitorPolicy === undefined
        ? {}
        : { monitorPolicy: query.monitorPolicy }),
    });
    const projections = dependencies.repositories.library.cardProjections(
      result.items.map((item) => item.id),
    );
    const liveDownloads = await withLiveDownloadProgress(
      [...projections.values()].flatMap((projection) =>
        projection.download?.active ? [projection.download] : [],
      ),
      dependencies,
      context.req.raw.signal,
    );
    const liveById = new Map(
      liveDownloads.map((download) => [download.id, download]),
    );
    const items = result.items.map((item) => {
      const projection = projections.get(item.id);
      const selectedDownload = projection?.download ?? null;
      const liveDownload =
        selectedDownload?.active === true
          ? (liveById.get(selectedDownload.id) ?? selectedDownload)
          : null;
      const activeDownload =
        liveDownload && isLibraryCardActiveDownloadState(liveDownload.state)
          ? liveDownload
          : null;
      return {
        ...item,
        rating: libraryCardRating(item.metadata),
        storage: {
          libraryPath: projection?.libraryPath ?? null,
          downloadPath: selectedDownload?.downloadPath ?? null,
          fileCount: projection?.fileCount ?? 0,
          totalBytes: projection?.totalBytes ?? 0,
          quality: projection?.quality ?? null,
        },
        activeDownload:
          activeDownload === null
            ? null
            : {
                id: activeDownload.id,
                state: activeDownload.state,
                progress: activeDownload.progress,
                downloadedBytes: activeDownload.downloadedBytes,
                totalBytes: activeDownload.totalBytes,
                downloadRate: activeDownload.downloadRate,
                etaSeconds: activeDownload.etaSeconds,
              },
        episodeProgress:
          item.kind === "series"
            ? {
                available: projection?.episodeAvailable ?? 0,
                total: projection?.episodeTotal ?? 0,
              }
            : null,
        nextAirDate:
          item.kind === "series" && projection?.nextAirAt
            ? new Date(projection.nextAirAt).toISOString()
            : null,
      };
    });
    return context.json(
      {
        items,
        page: { limit: query.limit, offset: query.offset, total: result.total },
        summary,
      },
      200,
    );
  });
  app.openapi(routes.getLibrary, (context) => {
    const item = dependencies.repositories.library.get(
      context.req.valid("param").id,
    );
    if (item === undefined) throw notFound("Library item not found");
    return context.json(item, 200);
  });
  app.openapi(routes.listCalendar, (context) => {
    const query = context.req.valid("query");
    return context.json(
      { events: dependencies.repositories.calendar.list(query.from, query.to) },
      200,
    );
  });
  app.openapi(routes.createCalendar, (context) =>
    context.json(
      dependencies.repositories.calendar.create(context.req.valid("json")),
      201,
    ),
  );
  app.openapi(routes.listJobs, async (context) => {
    const query = context.req.valid("query");
    if (dependencies.queue !== undefined) {
      const jobs = await dependencies.queue.list({
        limit: query.limit,
        offset: query.offset,
        ...(query.status === undefined ? {} : { states: [query.status] }),
        ...(query.kind === undefined ? {} : { types: [query.kind] }),
      });
      const total = await dependencies.queue.count({
        ...(query.status === undefined ? {} : { states: [query.status] }),
        ...(query.kind === undefined ? {} : { types: [query.kind] }),
      });
      return context.json(
        {
          jobs: jobs.map(durableJobToContract),
          page: { limit: query.limit, offset: query.offset, total },
        },
        200,
      );
    }
    const result = dependencies.repositories.jobs.list(query);
    return context.json(
      {
        jobs: result.jobs,
        page: { limit: query.limit, offset: query.offset, total: result.total },
      },
      200,
    );
  });
  app.openapi(routes.createJob, async (context) => {
    const input = context.req.valid("json");
    const manualJob = manualMaintenanceJob(input, dependencies);
    if (dependencies.queue !== undefined) {
      const job = await dependencies.queue.enqueue({
        type: manualJob.kind,
        payload: manualJob.payload,
      });
      dependencies.events?.publish("job.changed", { id: job.id });
      return context.json(durableJobToContract(job), 202);
    }
    return context.json(dependencies.repositories.jobs.create(manualJob), 202);
  });
  app.openapi(routes.getJob, async (context) => {
    if (dependencies.queue !== undefined) {
      const id = context.req.valid("param").id;
      const job = await dependencies.queue.get(id);
      if (job === null) throw notFound("Job not found");
      const logs = await dependencies.queue.logs(id);
      return context.json(
        {
          ...durableJobToContract(job),
          logs: logs.map((entry) => ({
            ...entry,
            timestamp: new Date(entry.timestamp).toISOString(),
          })),
        },
        200,
      );
    }
    const job = dependencies.repositories.jobs.get(
      context.req.valid("param").id,
    );
    if (job === undefined) throw notFound("Job not found");
    return context.json({ ...job, logs: [] }, 200);
  });
  app.openapi(routes.retryJob, async (context) => {
    const queue = requireDurableQueue(dependencies);
    const previous = await queue.get(context.req.valid("param").id);
    if (!previous) throw notFound("Job not found");
    if (previous.state !== "failed" && previous.state !== "cancelled") {
      throw new AppError({
        code: "conflict",
        message: "Only failed or cancelled jobs can be retried",
        status: 409,
      });
    }
    const retried = await queue.enqueue({
      type: previous.type,
      payload: previous.payload,
      ...(previous.dedupeKey === null ? {} : { dedupeKey: previous.dedupeKey }),
      priority: previous.priority,
      maxAttempts: previous.maxAttempts,
      runAt: clock.now().getTime(),
    });
    dependencies.events?.publish("job.changed", { id: retried.id });
    return context.json(durableJobToContract(retried), 202);
  });
  app.openapi(routes.cancelJob, async (context) => {
    const queue = requireDurableQueue(dependencies);
    const id = context.req.valid("param").id;
    const job = await queue.get(id);
    if (!job) throw notFound("Job not found");
    const cancelled = await (dependencies.cancelJob?.(id) ?? queue.cancel(id));
    if (!cancelled) {
      throw new AppError({
        code: "conflict",
        message: "Only queued or running jobs can be cancelled",
        status: 409,
      });
    }
    dependencies.events?.publish("job.changed", { id });
    return context.json({ id, cancelled: true as const }, 200);
  });

  registerProductRoutes(app, dependencies);
  registerBackupRestoreRoutes(app, dependencies);

  app.get("/api/openapi.json", (context) => {
    const document = app.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Bobarr API",
        version: dependencies.config.version,
        description: "Single-user media discovery and download management API",
      },
    });
    return context.json(
      finalizeOpenApiDocument(document, dependencies.config.sessionCookieName),
    );
  });

  app.notFound((context) =>
    context.json(
      {
        error: {
          code: "not_found" as const,
          message: "Route not found",
          requestId: context.get("requestId") || crypto.randomUUID(),
        },
      },
      404,
    ),
  );
  app.onError((error, context) => {
    const appError =
      error instanceof AppError
        ? error
        : new AppError({
            code: "internal_error",
            message: "An unexpected error occurred",
            status: 500,
            cause: error,
          });
    const requestId = context.get("requestId") || crypto.randomUUID();
    const logFields = {
      requestId,
      method: context.req.method,
      path: context.req.path,
      status: appError.status,
      error: appError,
    };
    if (appError.status >= 500) {
      dependencies.logger.error("http.request_failed", logFields);
    } else {
      dependencies.logger.warn("http.request_rejected", logFields);
    }
    return context.json(
      {
        error: {
          code: appError.code,
          message: appError.message,
          ...(appError.issues === undefined
            ? {}
            : { fieldErrors: issuesToFieldErrors(appError.issues) }),
          requestId,
        },
      },
      appError.status,
    );
  });

  return app;
}

function requestContextMiddleware(
  dependencies: ApiDependencies,
): MiddlewareHandler<ApiEnvironment> {
  return async (context, next) => {
    const startedAt = performance.now();
    const suppliedRequestId = context.req.header("x-request-id");
    const requestId =
      suppliedRequestId !== undefined &&
      /^[A-Za-z0-9._-]{1,100}$/.test(suppliedRequestId)
        ? suppliedRequestId
        : crypto.randomUUID();
    context.set("requestId", requestId);
    context.header("x-request-id", requestId);
    context.header("x-content-type-options", "nosniff");
    context.header("referrer-policy", "no-referrer");
    context.header("cache-control", "no-store");

    const method = context.req.method.toUpperCase();
    await next();
    dependencies.logger.info("http.request_completed", {
      requestId,
      method,
      path: context.req.path,
      status: context.res.status,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
  };
}

function authenticationMiddleware(
  dependencies: ApiDependencies,
): MiddlewareHandler<ApiEnvironment> {
  const publicPaths = new Set([
    "/api/v1/setup/status",
    "/api/v1/setup",
    "/api/v1/auth/login",
  ]);
  return async (context, next) => {
    if (publicPaths.has(context.req.path)) {
      await next();
      return;
    }
    if (!dependencies.auth.isSetupComplete()) {
      throw new AppError({
        code: "setup_required",
        message: "Complete first-run setup to continue",
        status: 409,
      });
    }
    const method = context.req.method.toUpperCase();
    const requireCsrf =
      method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
    context.set(
      "auth",
      dependencies.auth.authenticate(
        getCookie(context, dependencies.config.sessionCookieName),
        {
          csrfToken: context.req.header("x-csrf-token"),
          requireCsrf,
        },
      ),
    );
    await next();
  };
}

function setSessionCookie(
  context: Parameters<typeof setCookie>[0],
  config: BackendConfig,
  token: string,
): void {
  setCookie(context, config.sessionCookieName, token, {
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: "Strict",
    path: "/",
    maxAge: config.sessionTtlSeconds,
  });
}

function setCsrfCookie(
  context: Parameters<typeof setCookie>[0],
  config: BackendConfig,
  token: string,
): void {
  setCookie(context, csrfCookieName(config), token, {
    httpOnly: false,
    secure: config.sessionCookieSecure,
    sameSite: "Strict",
    path: "/",
    maxAge: config.sessionTtlSeconds,
  });
}

function csrfCookieName(config: BackendConfig): string {
  return `${config.sessionCookieName}_csrf`;
}

async function persistSecretInputs(
  vault: SecretVault,
  patch: Partial<AppSettings>,
): Promise<void> {
  const integrations = patch.integrations;
  if (integrations === undefined) return;
  const secretInputs = [
    ["tmdb.apiKey", integrations.tmdbApiKey],
    ["omdb.apiKey", integrations.omdbApiKey],
    ["jackett.apiKey", integrations.jackettApiKey],
    ["transmission.password", integrations.transmissionPassword],
  ] as const;
  for (const [name, value] of secretInputs) {
    if (value !== undefined && value.trim() !== "") {
      await vault.set(name, value.trim());
    }
  }
}

function withoutSecretInputs<T extends Partial<AppSettings>>(settings: T): T {
  if (settings.integrations === undefined) return settings;
  const {
    tmdbApiKey: _tmdbApiKey,
    omdbApiKey: _omdbApiKey,
    jackettApiKey: _jackettApiKey,
    transmissionPassword: _transmissionPassword,
    ...safeIntegrations
  } = settings.integrations;
  return { ...settings, integrations: safeIntegrations } as T;
}

function integrationKeysForSettings(
  patch: Partial<AppSettings>,
): IntegrationKey[] {
  const integrations = patch.integrations;
  if (integrations === undefined) return [];
  const keys = new Set<IntegrationKey>();
  for (const name of Object.keys(integrations)) {
    if (name === "tmdbApiKey") keys.add("tmdb");
    else if (name === "omdbApiKey") keys.add("omdb");
    else if (name === "jackettUrl" || name === "jackettApiKey") {
      keys.add("jackett");
    } else if (
      name === "transmissionUrl" ||
      name === "transmissionUsername" ||
      name === "transmissionPassword"
    ) {
      keys.add("transmission");
    }
  }
  return [...keys];
}

function integrationKeysForSecret(name: string): IntegrationKey[] {
  if (name === "tmdb.apiKey") return ["tmdb"];
  if (name === "omdb.apiKey") return ["omdb"];
  if (name === "jackett.apiKey") return ["jackett"];
  if (name === "transmission.password") return ["transmission"];
  return [];
}

function notifyIntegrationConfigurationChanged(
  dependencies: ApiDependencies,
  keys: readonly IntegrationKey[],
): void {
  if (keys.length === 0) return;
  dependencies.integrations?.invalidate(keys);
  dependencies.events?.publish("service.changed", {
    reason: "configuration-changed",
    integrations: [...keys],
  });
}

function validateSchedulePatch(patch: Partial<AppSettings>): void {
  if (patch.schedules === undefined) return;
  const issues = Object.entries(patch.schedules).flatMap(([name, expression]) =>
    name !== "backupRetention" &&
    typeof expression === "string" &&
    !validateCronExpression(expression)
      ? [
          {
            path: `schedules.${name}`,
            message: "Use a valid five-field cron expression",
          },
        ]
      : [],
  );
  if (issues.length > 0) {
    throw new AppError({
      code: "validation_failed",
      message: "Request validation failed",
      status: 422,
      issues,
    });
  }
}

function manualMaintenanceJob(
  input: { kind: string; payload: Record<string, unknown> },
  dependencies: ApiDependencies,
): { kind: string; payload: Record<string, unknown> } {
  const allowed = new Set([
    "library.scan.v1",
    "maintenance.reconcile.v1",
    "maintenance.backup.v1",
    "maintenance.cleanup.v1",
    "maintenance.search-missing.v1",
    "maintenance.refresh-metadata.v1",
  ]);
  if (!allowed.has(input.kind)) {
    throw new AppError({
      code: "bad_request",
      message: "Unsupported manual maintenance job",
      status: 400,
    });
  }
  if (input.kind !== "library.scan.v1") {
    return { kind: input.kind, payload: { version: 1 } };
  }
  const settings = dependencies.repositories.settings.ensureDefaults().settings;
  return {
    kind: input.kind,
    payload: {
      version: 1,
      roots: [settings.storage.moviesPath, settings.storage.televisionPath],
    },
  };
}

function requireDurableQueue(dependencies: ApiDependencies): JobQueue {
  if (!dependencies.queue) {
    throw new AppError({
      code: "service_unavailable",
      message: "The durable job queue is unavailable",
      status: 503,
    });
  }
  return dependencies.queue;
}

function issuesToFieldErrors(
  issues: readonly {
    path: string | readonly PropertyKey[];
    message: string;
  }[],
): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const path =
      (typeof issue.path === "string"
        ? issue.path
        : issue.path.map(String).join(".")) || "_root";
    (fieldErrors[path] ??= []).push(issue.message);
  }
  return fieldErrors;
}

function requestMetadata(request: Request): {
  userAgent?: string;
  ipAddress?: string;
} {
  const forwardedFor = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const userAgent = request.headers.get("user-agent") ?? undefined;
  return {
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(forwardedFor === undefined ? {} : { ipAddress: forwardedFor }),
  };
}

export type BobarrApi = ReturnType<typeof createApiApp>;
