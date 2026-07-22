import type { BackendRuntime } from "./initialize";

import { afterEach, describe, expect, test } from "bun:test";

import { initializeBackend } from "./initialize";
import {
  DEFAULT_API_REQUEST_BODY_MAX_BYTES,
  MAX_TORRENT_REQUEST_BODY_BYTES,
} from "./request-body-limit";
import {
  ApiErrorEnvelopeSchema,
  AuthSessionSchema,
  JobsListResponseSchema,
  JobDetailsSchema,
  JobSchema,
  SetupStatusSchema,
  SystemStatusSchema,
} from "../../contracts";
import { createEncryptionKey, type BackendConfig } from "../config";

const runtimes: BackendRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});

describe("Bobarr backend API", () => {
  test("closes the runtime idempotently after graceful shutdown begins", async () => {
    const runtime = await createTestRuntime();
    runtime.beginShutdown();

    const firstClose = runtime.close({ deadlineAt: Date.now() + 100 });
    expect(runtime.close()).toBe(firstClose);
    expect(await firstClose).toEqual({ forced: false });
    expect(() => runtime.database.sqlite.query("SELECT 1").get()).toThrow();
  });

  test("initializes migrations and publishes an OpenAPI 3.1 contract", async () => {
    const runtime = await createTestRuntime();
    const statusResponse = await runtime.app.request("/api/v1/setup/status");
    expect(statusResponse.status).toBe(200);
    expect(SetupStatusSchema.parse(await statusResponse.json())).toEqual({
      setupRequired: true,
    });
    expect(runtime.database.migrationVersion).toBe(5);
    expect(runtime.repositories.settings.ensureDefaults().version).toBe(1);
    expect(
      runtime.repositories.settings.ensureDefaults().settings.acquisition
        .requiredTerms,
    ).toEqual([]);

    const scheduledMaintenance = await runtime.queue.list({
      types: ["library.scan.v1", "maintenance.backup.v1"],
    });
    expect(scheduledMaintenance).toHaveLength(2);
    expect(scheduledMaintenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "library.scan.v1",
          state: "queued",
          attempt: 0,
          maxAttempts: 3,
        }),
        expect.objectContaining({
          type: "maintenance.backup.v1",
          state: "queued",
          attempt: 0,
          maxAttempts: 3,
        }),
      ]),
    );
    expect(scheduledMaintenance.every((job) => job.runAt > Date.now())).toBe(
      true,
    );

    const openApiResponse = await runtime.app.request("/api/openapi.json");
    expect(openApiResponse.status).toBe(200);
    const document = (await openApiResponse.json()) as {
      openapi?: string;
      paths?: Record<string, unknown>;
    };
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths?.["/api/v1/library"]).toBeDefined();
    expect(document.paths?.["/api/v1/settings/secrets/{name}"]).toBeDefined();
  });

  test("allows API requests and preflights from every origin", async () => {
    const runtime = await createTestRuntime();
    const origin = "http://100.64.0.1:3000";

    const response = await runtime.app.request("/api/v1/setup/status", {
      headers: { origin },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");

    const preflight = await runtime.app.request("/api/v1/setup", {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-csrf-token",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
    expect(preflight.headers.get("access-control-allow-headers")).toBe(
      "content-type,x-csrf-token",
    );
  });

  test("documents CSRF requirements and public query and response contracts", async () => {
    const runtime = await createTestRuntime();
    const response = await runtime.app.request("/api/openapi.json");
    const document = (await response.json()) as OpenApiDocument;

    expect(document.components?.securitySchemes?.["csrfToken"]).toMatchObject({
      type: "apiKey",
      in: "header",
      name: "x-csrf-token",
    });

    const publicMutations = new Set([
      "post /api/v1/setup",
      "post /api/v1/auth/login",
    ]);
    const mutationMethods = new Set(["post", "put", "patch", "delete"]);
    const authenticatedMutations: string[] = [];
    for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
      if (!path.startsWith("/api/v1/")) continue;
      for (const [method, operation] of Object.entries(pathItem)) {
        if (
          !mutationMethods.has(method) ||
          publicMutations.has(`${method} ${path}`)
        ) {
          continue;
        }
        authenticatedMutations.push(`${method} ${path}`);
        expect(operation.security).toEqual([
          { sessionCookie: [], csrfToken: [] },
        ]);
      }
    }
    expect(authenticatedMutations.length).toBeGreaterThan(10);

    const libraryResponses = apiOperation(
      document,
      "/api/v1/library",
      "post",
    ).responses;
    expect(responseSchemaReference(libraryResponses?.["200"])).toBe(
      "#/components/schemas/LibraryItem",
    );
    expect(responseSchemaReference(libraryResponses?.["201"])).toBe(
      "#/components/schemas/LibraryItem",
    );

    const genreKind = queryParameter(
      apiOperation(document, "/api/v1/catalog/genres", "get"),
      "kind",
    );
    expect(genreKind.schema).toMatchObject({
      type: "string",
      enum: ["movie", "series"],
      default: "movie",
    });

    const activity = apiOperation(document, "/api/v1/system/activity", "get");
    expect(queryParameter(activity, "limit").schema).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 100,
      default: 50,
    });
    expect(queryParameter(activity, "offset").schema).toMatchObject({
      minimum: 0,
      default: 0,
    });

    const jobs = apiOperation(document, "/api/v1/jobs", "get");
    expect(queryParameter(jobs, "kind").schema).toMatchObject({
      type: "string",
      minLength: 1,
      maxLength: 100,
    });
  });

  test("paginates jobs within an exact job-kind filter", async () => {
    const runtime = await createTestRuntime();
    const setupResponse = await jsonRequest(runtime, "/api/v1/setup", "POST", {
      username: "admin",
      password: "a-correct-horse-battery-staple",
    });
    const cookie = extractCookie(setupResponse);
    await runtime.queue.enqueue({
      type: "test.activity-page.v1",
      payload: { sequence: 1 },
    });
    await runtime.queue.enqueue({
      type: "media.acquire.v1",
      payload: { sequence: 2 },
    });
    await runtime.queue.enqueue({
      type: "test.activity-page.v1",
      payload: { sequence: 3 },
    });

    const firstResponse = await runtime.app.request(
      "/api/v1/jobs?kind=test.activity-page.v1&limit=1&offset=0",
      { headers: { cookie } },
    );
    const secondResponse = await runtime.app.request(
      "/api/v1/jobs?kind=test.activity-page.v1&limit=1&offset=1",
      { headers: { cookie } },
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    const firstPage = JobsListResponseSchema.parse(await firstResponse.json());
    const secondPage = JobsListResponseSchema.parse(
      await secondResponse.json(),
    );
    expect(firstPage.page).toEqual({ limit: 1, offset: 0, total: 2 });
    expect(secondPage.page).toEqual({ limit: 1, offset: 1, total: 2 });
    expect(firstPage.jobs[0]?.kind).toBe("test.activity-page.v1");
    expect(secondPage.jobs[0]?.kind).toBe("test.activity-page.v1");
    expect(secondPage.jobs[0]?.id).not.toBe(firstPage.jobs[0]?.id);
  });

  test("persists setup, enforces session CSRF, and returns standard errors", async () => {
    const runtime = await createTestRuntime();
    const setupResponse = await jsonRequest(runtime, "/api/v1/setup", "POST", {
      username: "admin",
      password: "a-correct-horse-battery-staple",
    });
    expect(setupResponse.status).toBe(201);
    const session = AuthSessionSchema.parse(await setupResponse.json());
    const cookie = extractCookie(setupResponse);
    expect(cookie).toStartWith("bobarr_session=");
    expect(runtime.repositories.auth.isSetupComplete()).toBe(true);

    const systemResponse = await runtime.app.request("/api/v1/system", {
      headers: { cookie },
    });
    expect(systemResponse.status).toBe(200);
    expect(
      SystemStatusSchema.parse(await systemResponse.json()).setupComplete,
    ).toBe(true);

    const rejectedJob = await jsonRequest(
      runtime,
      "/api/v1/jobs",
      "POST",
      { kind: "library.scan", payload: {} },
      { cookie },
    );
    expect(rejectedJob.status).toBe(403);
    expect(
      ApiErrorEnvelopeSchema.parse(await rejectedJob.json()).error.code,
    ).toBe("forbidden");

    const acceptedJob = await jsonRequest(
      runtime,
      "/api/v1/jobs",
      "POST",
      { kind: "library.scan.v1", payload: { source: "manual" } },
      { cookie, "x-csrf-token": session.csrfToken },
    );
    expect(acceptedJob.status).toBe(202);
    const job = JobSchema.parse(await acceptedJob.json());
    expect((await runtime.queue.get(job.id))?.payload).toEqual({
      version: 1,
      roots: ["/media/movies", "/media/tv"],
    });
    const jobDetailsResponse = await runtime.app.request(
      `/api/v1/jobs/${job.id}`,
      { headers: { cookie } },
    );
    expect(jobDetailsResponse.status).toBe(200);
    expect(
      JobDetailsSchema.parse(await jobDetailsResponse.json()),
    ).toMatchObject({
      id: job.id,
      attempt: 0,
      maxAttempts: 5,
      logs: [{ level: "info", event: "job.queued" }],
    });
    const cancelledJob = await jsonRequest(
      runtime,
      `/api/v1/jobs/${job.id}`,
      "DELETE",
      {},
      { cookie, "x-csrf-token": session.csrfToken },
    );
    expect(cancelledJob.status).toBe(200);
    expect(await cancelledJob.json()).toEqual({
      id: job.id,
      cancelled: true,
    });
    expect(await runtime.queue.get(job.id)).toMatchObject({
      state: "cancelled",
    });
    const retriedJob = await jsonRequest(
      runtime,
      `/api/v1/jobs/${job.id}/retry`,
      "POST",
      {},
      { cookie, "x-csrf-token": session.csrfToken },
    );
    expect(retriedJob.status).toBe(202);
    expect(JobSchema.parse(await retriedJob.json())).toMatchObject({
      kind: "library.scan.v1",
      status: "queued",
    });

    const invalidLibraryItem = await jsonRequest(
      runtime,
      "/api/v1/library",
      "POST",
      { kind: "movie", title: "" },
      { cookie, "x-csrf-token": session.csrfToken },
    );
    expect(invalidLibraryItem.status).toBe(422);
    const validationError = ApiErrorEnvelopeSchema.parse(
      await invalidLibraryItem.json(),
    );
    expect(validationError.error.code).toBe("validation_failed");
    expect(validationError.error.requestId.length).toBeGreaterThan(0);
  });

  test("rejects declared and chunked oversized bodies before request parsers", async () => {
    const runtime = await createTestRuntime();

    await expectPayloadTooLarge(
      runtime.app.fetch(
        declaredOversizedRequest(
          "/api/v1/setup",
          DEFAULT_API_REQUEST_BODY_MAX_BYTES,
        ),
      ),
    );
    await expectPayloadTooLarge(
      runtime.app.fetch(
        chunkedRequest("/api/v1/setup", DEFAULT_API_REQUEST_BODY_MAX_BYTES + 1),
      ),
    );
    expect(runtime.auth.isSetupComplete()).toBe(false);

    const setup = await jsonRequest(runtime, "/api/v1/setup", "POST", {
      username: "admin",
      password: "a-correct-horse-battery-staple",
    });
    const session = AuthSessionSchema.parse(await setup.json());
    const cookie = extractCookie(setup);

    await expectPayloadTooLarge(
      runtime.app.fetch(
        declaredOversizedRequest(
          "/api/v1/auth/login",
          DEFAULT_API_REQUEST_BODY_MAX_BYTES,
        ),
      ),
    );
    await expectPayloadTooLarge(
      runtime.app.fetch(
        chunkedRequest(
          "/api/v1/auth/login",
          DEFAULT_API_REQUEST_BODY_MAX_BYTES + 1,
        ),
      ),
    );
    await expectPayloadTooLarge(
      runtime.app.fetch(
        chunkedRequest("/api/v1/jobs", DEFAULT_API_REQUEST_BODY_MAX_BYTES + 1, {
          cookie,
          "x-csrf-token": session.csrfToken,
        }),
      ),
    );
    await expectPayloadTooLarge(
      runtime.app.fetch(
        declaredOversizedRequest(
          "/api/v1/downloads",
          MAX_TORRENT_REQUEST_BODY_BYTES,
          {
            cookie,
            "content-type": "multipart/form-data; boundary=bobarr-test",
            "x-csrf-token": session.csrfToken,
          },
        ),
      ),
    );
    await expectPayloadTooLarge(
      runtime.app.fetch(
        chunkedRequest(
          "/api/v1/downloads",
          MAX_TORRENT_REQUEST_BODY_BYTES + 1,
          {
            cookie,
            "content-type": "multipart/form-data; boundary=bobarr-test",
            "x-csrf-token": session.csrfToken,
          },
        ),
      ),
    );
  });

  test("encrypts setting secrets and never returns plaintext metadata", async () => {
    const runtime = await createTestRuntime();
    const metadata = await runtime.secrets.set(
      "jackett.apiKey",
      "not-plain-at-rest",
    );
    expect(metadata).toMatchObject({
      name: "jackett.apiKey",
      configured: true,
    });
    const stored = runtime.repositories.secrets.get("jackett.apiKey");
    expect(stored?.ciphertext).not.toContain("not-plain-at-rest");
    expect(await runtime.secrets.get("jackett.apiKey")).toBe(
      "not-plain-at-rest",
    );
    expect(runtime.secrets.list()).toEqual([metadata]);
  });

  test("persists required release terms through the settings contract", async () => {
    const runtime = await createTestRuntime();
    const setupResponse = await jsonRequest(runtime, "/api/v1/setup", "POST", {
      username: "admin",
      password: "a-correct-horse-battery-staple",
    });
    const session = AuthSessionSchema.parse(await setupResponse.json());
    const cookie = extractCookie(setupResponse);

    const updated = await jsonRequest(
      runtime,
      "/api/v1/settings",
      "PATCH",
      { acquisition: { requiredTerms: ["proper", "x265"] } },
      { cookie, "x-csrf-token": session.csrfToken },
    );

    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      acquisition: { requiredTerms: ["proper", "x265"] },
    });
    expect(
      runtime.repositories.settings.getRequired().settings.acquisition
        .requiredTerms,
    ).toEqual(["proper", "x265"]);
  });
});

async function createTestRuntime(): Promise<BackendRuntime> {
  const config: BackendConfig = {
    environment: "test",
    version: "test",
    databasePath: ":memory:",
    encryptionKey: createEncryptionKey(),
    sessionCookieName: "bobarr_session",
    sessionTtlSeconds: 3_600,
    sessionCookieSecure: false,
    loginFailureLimit: 5,
    loginLockSeconds: 60,
  };
  const runtime = await initializeBackend({ config });
  runtimes.push(runtime);
  return runtime;
}

function jsonRequest(
  runtime: BackendRuntime,
  path: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    runtime.app.request(path, {
      method,
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function extractCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) throw new Error("Expected a session cookie");
  return setCookie.split(";", 1)[0] ?? "";
}

function declaredOversizedRequest(
  path: string,
  limit: number,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-length": String(limit + 1),
      "content-type": "application/json",
      ...headers,
    },
    body: "{}",
  });
}

function chunkedRequest(
  path: string,
  size: number,
  headers: Record<string, string> = {},
): Request {
  let remaining = size;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (remaining === 0) {
        controller.close();
        return;
      }
      const length = Math.min(64 * 1024, remaining);
      remaining -= length;
      controller.enqueue(new Uint8Array(length));
    },
  });
  const request = new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
  expect(request.headers.get("content-length")).toBeNull();
  return request;
}

async function expectPayloadTooLarge(
  response: Response | Promise<Response>,
): Promise<void> {
  const resolved = await response;
  expect(resolved.status).toBe(413);
  expect(ApiErrorEnvelopeSchema.parse(await resolved.json()).error.code).toBe(
    "payload_too_large",
  );
}

interface OpenApiDocument {
  components?: {
    securitySchemes?: Record<string, Record<string, unknown>>;
  };
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

interface OpenApiOperation {
  parameters?: OpenApiParameter[];
  responses?: Record<string, OpenApiResponse>;
  security?: Array<Record<string, string[]>>;
}

interface OpenApiParameter {
  in?: string;
  name?: string;
  schema?: Record<string, unknown>;
}

interface OpenApiResponse {
  content?: Record<string, { schema?: Record<string, unknown> }>;
}

function apiOperation(
  document: OpenApiDocument,
  path: string,
  method: string,
): OpenApiOperation {
  const operation = document.paths?.[path]?.[method];
  if (operation === undefined) {
    throw new Error(`Missing OpenAPI operation ${method} ${path}`);
  }
  return operation;
}

function queryParameter(
  operation: OpenApiOperation,
  name: string,
): OpenApiParameter & { schema: Record<string, unknown> } {
  const parameter = operation.parameters?.find(
    (candidate) => candidate.in === "query" && candidate.name === name,
  );
  if (parameter?.schema === undefined) {
    throw new Error(`Missing OpenAPI query parameter ${name}`);
  }
  return { ...parameter, schema: parameter.schema };
}

function responseSchemaReference(response?: OpenApiResponse): unknown {
  return response?.content?.["application/json"]?.schema?.["$ref"];
}
