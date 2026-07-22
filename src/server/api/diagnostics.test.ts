import type { BackendConfig } from "../config";
import type { BackendRuntime } from "./initialize";

import { afterEach, describe, expect, test } from "bun:test";

import { initializeBackend } from "./initialize";
import { AuthSessionSchema, SystemStatusSchema } from "../../contracts";
import { createEncryptionKey } from "../config";

const NATIVE_FETCH = globalThis.fetch;
const runtimes: BackendRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  globalThis.fetch = NATIVE_FETCH;
});

describe("integration diagnostics", () => {
  test("is ready when required services are healthy and optional OMDb is unconfigured", async () => {
    const fixture = await createFixture(true);
    const session = await setup(fixture.runtime);

    const response = await fixture.runtime.app.request("/api/v1/system", {
      headers: { cookie: session.cookie },
    });
    const status = SystemStatusSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(status.status).toBe("ready");
    expect(status.integrations.find(({ key }) => key === "omdb")).toMatchObject(
      {
        configured: false,
        healthy: false,
      },
    );
  });

  test("is degraded when required services are unconfigured", async () => {
    const fixture = await createFixture(false);
    const session = await setup(fixture.runtime);

    const response = await fixture.runtime.app.request("/api/v1/system", {
      headers: { cookie: session.cookie },
    });
    const status = SystemStatusSchema.parse(await response.json());

    expect(status.status).toBe("degraded");
    expect(status.integrations.find(({ key }) => key === "tmdb")).toMatchObject(
      { configured: false, healthy: false },
    );
    expect(
      status.integrations.find(({ key }) => key === "jackett"),
    ).toMatchObject({ configured: false, healthy: false });
    expect(
      status.integrations.find(({ key }) => key === "transmission"),
    ).toMatchObject({ configured: true, healthy: true });
  });

  test("refreshes cached status after configuration changes and connection tests", async () => {
    const fixture = await createFixture(true);
    const session = await setup(fixture.runtime);
    const reader = fixture.runtime.events.stream().getReader();
    await reader.read(); // Initial snapshot invalidation.

    await getSystem(fixture.runtime, session.cookie);
    expect(fixture.services.jackettCalls).toBe(1);

    fixture.services.jackettHealthy = false;
    const settingsResponse = await jsonRequest(
      fixture.runtime,
      "/api/v1/settings",
      "PATCH",
      { integrations: { jackettUrl: "http://jackett.test" } },
      session,
    );
    expect(settingsResponse.status).toBe(200);
    expect(await nextEvent(reader)).toMatchObject({
      type: "service.changed",
      data: {
        reason: "configuration-changed",
        integrations: expect.arrayContaining(["jackett"]),
      },
    });
    expect((await getSystem(fixture.runtime, session.cookie)).status).toBe(
      "degraded",
    );
    expect(fixture.services.jackettCalls).toBe(2);

    fixture.services.jackettHealthy = true;
    const testResponse = await jsonRequest(
      fixture.runtime,
      "/api/v1/settings/integrations/jackett/test",
      "POST",
      undefined,
      session,
    );
    expect(testResponse.status).toBe(200);
    expect(await testResponse.json()).toMatchObject({ healthy: true });
    expect(await nextEvent(reader)).toMatchObject({
      type: "service.changed",
      data: {
        reason: "connection-tested",
        integrations: ["jackett"],
      },
    });
    fixture.services.jackettHealthy = false;
    expect((await getSystem(fixture.runtime, session.cookie)).status).toBe(
      "ready",
    );
    expect(fixture.services.jackettCalls).toBe(3);

    const secretResponse = await jsonRequest(
      fixture.runtime,
      "/api/v1/settings/secrets/jackett.apiKey",
      "PUT",
      { value: "rotated-jackett-key" },
      session,
    );
    expect(secretResponse.status).toBe(200);
    expect(await nextEvent(reader)).toMatchObject({
      type: "service.changed",
      data: {
        reason: "configuration-changed",
        integrations: ["jackett"],
      },
    });
    expect((await getSystem(fixture.runtime, session.cookie)).status).toBe(
      "degraded",
    );
    expect(fixture.services.jackettCalls).toBe(4);

    await reader.cancel();
  });

  test("uses the Jackett URL saved in Settings without an operator override", async () => {
    const fixture = await createFixture(true, {
      jackettUrlFromEnvironment: false,
    });
    const session = await setup(fixture.runtime);

    const settingsResponse = await jsonRequest(
      fixture.runtime,
      "/api/v1/settings",
      "PATCH",
      { integrations: { jackettUrl: "http://jackett.test" } },
      session,
    );
    expect(settingsResponse.status).toBe(200);

    const testResponse = await jsonRequest(
      fixture.runtime,
      "/api/v1/settings/integrations/jackett/test",
      "POST",
      undefined,
      session,
    );
    expect(testResponse.status).toBe(200);
    expect(await testResponse.json()).toMatchObject({ healthy: true });
    expect(fixture.services.jackettCalls).toBe(1);
  });
});

class FakeDiagnosticServices {
  jackettHealthy = true;
  jackettCalls = 0;

  readonly fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = requestUrl(input);
    if (url.hostname === "tmdb.test") {
      return Response.json({
        page: 1,
        total_pages: 0,
        total_results: 0,
        results: [],
      });
    }
    if (url.hostname === "jackett.test") {
      this.jackettCalls += 1;
      return this.jackettHealthy
        ? new Response(
            `<?xml version="1.0"?>
              <indexers>
                <indexer id="example" configured="true">
                  <title>Example</title>
                  <caps><server title="Jackett" /></caps>
                </indexer>
              </indexers>`,
            {
              headers: { "content-type": "application/xml" },
            },
          )
        : new Response("unavailable", { status: 503 });
    }
    if (url.hostname === "transmission.test") {
      const request = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
      };
      let result: Record<string, unknown> = {};
      if (request.method === "session_get") {
        result = { version: "4.1.3", rpc_version_semver: "6.0.1" };
      } else if (request.method === "torrent_get") {
        result = { torrents: [] };
      }
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result,
      });
    }
    throw new Error(`Unexpected diagnostics request: ${url.href}`);
  };
}

async function createFixture(
  configureRequired: boolean,
  options: { jackettUrlFromEnvironment?: boolean } = {},
): Promise<{
  runtime: BackendRuntime;
  services: FakeDiagnosticServices;
}> {
  const services = new FakeDiagnosticServices();
  globalThis.fetch = services.fetch as typeof globalThis.fetch;
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
  const environment: Record<string, string> = {
    NODE_ENV: "test",
    BOBARR_TRANSMISSION_URL: "http://transmission.test/rpc",
  };
  if (configureRequired) {
    Object.assign(environment, {
      TMDB_API_KEY: "tmdb-key",
      BOBARR_TMDB_URL: "http://tmdb.test/3/",
      BOBARR_JACKETT_API_KEY: "jackett-key",
    });
    if (options.jackettUrlFromEnvironment !== false) {
      environment["BOBARR_JACKETT_URL"] = "http://jackett.test";
    }
  }
  const runtime = await initializeBackend({ config, environment });
  runtimes.push(runtime);
  return { runtime, services };
}

async function setup(runtime: BackendRuntime): Promise<Session> {
  const response = await jsonRequest(runtime, "/api/v1/setup", "POST", {
    username: "admin",
    password: "correct-horse-battery-staple",
  });
  const session = AuthSessionSchema.parse(await response.json());
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("Expected setup session cookie");
  return { cookie, csrfToken: session.csrfToken };
}

async function getSystem(
  runtime: BackendRuntime,
  cookie: string,
): Promise<ReturnType<typeof SystemStatusSchema.parse>> {
  const response = await runtime.app.request("/api/v1/system", {
    headers: { cookie },
  });
  return SystemStatusSchema.parse(await response.json());
}

function jsonRequest(
  runtime: BackendRuntime,
  path: string,
  method: string,
  body?: unknown,
  session?: Session,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (session) {
    headers["cookie"] = session.cookie;
    headers["x-csrf-token"] = session.csrfToken;
  }
  return Promise.resolve(
    runtime.app.request(path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function nextEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<{ type: string; data: Record<string, unknown> }> {
  const result = await reader.read();
  if (result.done || result.value === undefined) {
    throw new Error("Expected an SSE event");
  }
  const frame = new TextDecoder().decode(result.value);
  const data = frame
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  if (!data) throw new Error(`Expected SSE data in ${frame}`);
  return JSON.parse(data) as { type: string; data: Record<string, unknown> };
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  if (input instanceof Request) return new URL(input.url);
  return new URL(input);
}

interface Session {
  cookie: string;
  csrfToken: string;
}
