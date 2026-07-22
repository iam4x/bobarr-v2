import type { BackendRuntime } from "./initialize";

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initializeBackend } from "./initialize";
import { DEFAULT_API_REQUEST_BODY_MAX_BYTES } from "./request-body-limit";
import {
  AuthSessionSchema,
  BackupRestoreStatusSchema,
  StagedRestoreSchema,
} from "../../contracts";
import { createEncryptionKey, type BackendConfig } from "../config";

const runtimes: BackendRuntime[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("authenticated backup restore API", () => {
  test("requires a session and CSRF confirmation before staging a verified image", async () => {
    const fixture = await createDiskRuntime();
    const setup = await fixture.runtime.app.request("/api/v1/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "admin",
        password: "a-correct-horse-battery-staple",
      }),
    });
    const session = AuthSessionSchema.parse(await setup.json());
    const cookie = extractCookie(setup);

    const unauthenticated = await fixture.runtime.app.request(
      "/api/v1/system/backups",
    );
    expect(unauthenticated.status).toBe(401);

    const statusResponse = await fixture.runtime.app.request(
      "/api/v1/system/backups",
      { headers: { cookie } },
    );
    expect(statusResponse.status).toBe(200);
    expect(
      BackupRestoreStatusSchema.parse(await statusResponse.json()),
    ).toMatchObject({ backups: [], stagedRestore: null });

    fixture.runtime.database.sqlite.exec(`
      CREATE TABLE restore_padding (value BLOB NOT NULL);
      INSERT INTO restore_padding VALUES (zeroblob(${DEFAULT_API_REQUEST_BODY_MAX_BYTES + 1}));
    `);
    const image = fixture.runtime.database.sqlite.serialize("main");
    expect(image.byteLength).toBeGreaterThan(
      DEFAULT_API_REQUEST_BODY_MAX_BYTES,
    );
    const imageBody = image.buffer.slice(
      image.byteOffset,
      image.byteOffset + image.byteLength,
    ) as ArrayBuffer;
    const missingCsrf = await fixture.runtime.app.request(
      "/api/v1/system/restore",
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/octet-stream",
          "x-bobarr-restore-confirmation": "stage-restore",
        },
        body: imageBody,
      },
    );
    expect(missingCsrf.status).toBe(403);

    const stagedResponse = await fixture.runtime.app.request(
      "/api/v1/system/restore",
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/octet-stream",
          "x-bobarr-restore-confirmation": "stage-restore",
          "x-csrf-token": session.csrfToken,
        },
        body: imageBody,
      },
    );
    expect(stagedResponse.status).toBe(202);
    expect(
      StagedRestoreSchema.parse(await stagedResponse.json()).restartRequired,
    ).toBe(true);

    const openApi = (await (
      await fixture.runtime.app.request("/api/openapi.json")
    ).json()) as { paths?: Record<string, unknown> };
    expect(openApi.paths?.["/api/v1/system/backups"]).toBeDefined();
    expect(openApi.paths?.["/api/v1/system/restore"]).toBeDefined();

    await fixture.runtime.close();
    const restarted = await initializeBackend({
      config: fixture.config,
      environment: {},
    });
    runtimes.push(restarted);
    expect(await restarted.restore.getStagedRestore()).toBeNull();
    expect(
      (await readdir(join(fixture.root, "backups"))).some((name) =>
        name.startsWith("bobarr-pre-restore-"),
      ),
    ).toBe(true);
  });
});

async function createDiskRuntime(): Promise<{
  root: string;
  config: BackendConfig;
  runtime: BackendRuntime;
}> {
  const root = await mkdtemp(join(tmpdir(), "bobarr-restore-api-"));
  temporaryDirectories.push(root);
  const config: BackendConfig = {
    environment: "test",
    version: "test",
    databasePath: join(root, "bobarr.sqlite"),
    encryptionKey: createEncryptionKey(),
    sessionCookieName: "bobarr_session",
    sessionTtlSeconds: 3_600,
    sessionCookieSecure: false,
    loginFailureLimit: 5,
    loginLockSeconds: 60,
  };
  const runtime = await initializeBackend({ config, environment: {} });
  runtimes.push(runtime);
  return { root, config, runtime };
}

function extractCookie(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  const match = /(?:^|,\s*)(bobarr_session=[^;]+)/.exec(header);
  if (match?.[1] === undefined) throw new Error("Session cookie was not set");
  return match[1];
}
