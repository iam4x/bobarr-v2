import type { BackendRuntime } from "./initialize";

import { afterEach, describe, expect, test } from "bun:test";

import { initializeBackend } from "./initialize";
import {
  ApiErrorEnvelopeSchema,
  AuthSessionSchema,
  CreatedInviteSchema,
  InvitePreviewSchema,
  LibraryItemSchema,
  UsersResponseSchema,
} from "../../contracts";
import { createEncryptionKey, type BackendConfig } from "../config";

const runtimes: BackendRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});

describe("user ranks, invites, and ownership", () => {
  test("setup creates admin id 1 and a friend logs in as themselves", async () => {
    const runtime = await createRuntime();
    const admin = await setupAdmin(runtime);
    expect(admin.session.user).toMatchObject({
      id: 1,
      username: "admin",
      rank: "admin",
    });
    expect(admin.session.capabilities.canManageSettings).toBe(true);

    const friend = await inviteFriend(runtime, admin.headers);
    expect(friend.session.user.id).not.toBe(1);
    expect(friend.session.user).toMatchObject({
      username: "friend",
      rank: "user",
    });
    expect(friend.session.capabilities).toEqual({
      rank: "user",
      canManageSettings: false,
    });
  });

  test("invite create, accept, second accept conflicts, expired fails", async () => {
    const runtime = await createRuntime();
    const admin = await setupAdmin(runtime);
    const created = await jsonRequest(
      runtime,
      "/api/v1/users/invites",
      "POST",
      { expiresInSeconds: 60 },
      admin.headers,
    );
    expect(created.status).toBe(201);
    const invite = CreatedInviteSchema.parse(await created.json());

    const preview = await runtime.app.request(
      `/api/v1/invites/preview?token=${encodeURIComponent(invite.token)}`,
    );
    expect(preview.status).toBe(200);
    expect(InvitePreviewSchema.parse(await preview.json()).status).toBe("open");

    const accepted = await jsonRequest(
      runtime,
      "/api/v1/invites/accept",
      "POST",
      {
        token: invite.token,
        username: "friend",
        password: "friend-pass",
      },
    );
    expect(accepted.status).toBe(201);

    const second = await jsonRequest(
      runtime,
      "/api/v1/invites/accept",
      "POST",
      {
        token: invite.token,
        username: "other",
        password: "other-pass",
      },
    );
    expect(second.status).toBe(409);
    expect(ApiErrorEnvelopeSchema.parse(await second.json()).error.code).toBe(
      "conflict",
    );

    const expiredCreate = await jsonRequest(
      runtime,
      "/api/v1/users/invites",
      "POST",
      { expiresInSeconds: 1 },
      admin.headers,
    );
    const expiredInvite = CreatedInviteSchema.parse(await expiredCreate.json());
    runtime.database.sqlite
      .query("UPDATE invites SET expires_at = 1 WHERE id = ?")
      .run(expiredInvite.id);
    const expiredAccept = await jsonRequest(
      runtime,
      "/api/v1/invites/accept",
      "POST",
      {
        token: expiredInvite.token,
        username: "late",
        password: "late-pass",
      },
    );
    expect(expiredAccept.status).toBe(404);
  });

  test("users cannot read or change settings or run maintenance", async () => {
    const runtime = await createRuntime();
    const admin = await setupAdmin(runtime);
    const friend = await inviteFriend(runtime, admin.headers);

    const getSettings = await runtime.app.request("/api/v1/settings", {
      headers: { cookie: friend.headers.cookie },
    });
    expect(getSettings.status).toBe(403);

    const patchSettings = await jsonRequest(
      runtime,
      "/api/v1/settings",
      "PATCH",
      { locale: { language: "fr" } },
      friend.headers,
    );
    expect(patchSettings.status).toBe(403);

    const jobs = await jsonRequest(
      runtime,
      "/api/v1/jobs",
      "POST",
      { kind: "maintenance.backup.v1" },
      friend.headers,
    );
    expect(jobs.status).toBe(403);

    const scan = await jsonRequest(
      runtime,
      "/api/v1/library/scan",
      "POST",
      {},
      friend.headers,
    );
    expect(scan.status).toBe(403);
  });

  test("a user owns titles they add and cannot delete admin media", async () => {
    const runtime = await createRuntime();
    const admin = await setupAdmin(runtime);
    const friend = await inviteFriend(runtime, admin.headers);

    const adminTitle = runtime.repositories.media.create({
      kind: "movie",
      tmdbId: 11,
      parentId: null,
      seasonNumber: null,
      episodeNumber: null,
      title: "Admin Movie",
      year: 1999,
      posterUrl: null,
      status: "missing",
      monitorPolicy: "all",
      releaseDate: null,
      metadata: {},
      createdByUserId: 1,
    });

    const added = runtime.repositories.media.create({
      kind: "movie",
      tmdbId: 22,
      parentId: null,
      seasonNumber: null,
      episodeNumber: null,
      title: "Friend Movie",
      year: 2001,
      posterUrl: null,
      status: "missing",
      monitorPolicy: "all",
      releaseDate: null,
      metadata: {},
      createdByUserId: friend.session.user.id,
    });

    const denied = await jsonRequest(
      runtime,
      `/api/v1/library/${adminTitle.id}`,
      "DELETE",
      { deleteLibraryRecord: true },
      friend.headers,
    );
    expect(denied.status).toBe(403);
    expect(runtime.repositories.media.get(adminTitle.id)?.id).toBe(
      adminTitle.id,
    );

    const owned = await jsonRequest(
      runtime,
      `/api/v1/library/${added.id}`,
      "DELETE",
      { deleteLibraryRecord: true },
      friend.headers,
    );
    expect(owned.status).toBe(200);
    expect(runtime.repositories.media.get(added.id)).toBeUndefined();

    const adminDelete = await jsonRequest(
      runtime,
      `/api/v1/library/${adminTitle.id}`,
      "DELETE",
      { deleteLibraryRecord: true },
      admin.headers,
    );
    expect(adminDelete.status).toBe(200);

    const listed = await runtime.app.request("/api/v1/library?kind=movie", {
      headers: { cookie: friend.headers.cookie },
    });
    expect(listed.status).toBe(200);
  });

  test("admin can list people, revoke unused invites, and delete a non-last user", async () => {
    const runtime = await createRuntime();
    const admin = await setupAdmin(runtime);
    const friend = await inviteFriend(runtime, admin.headers);

    const listed = await runtime.app.request("/api/v1/users", {
      headers: { cookie: admin.headers.cookie },
    });
    expect(listed.status).toBe(200);
    const people = UsersResponseSchema.parse(await listed.json());
    expect(people.users.map((user) => user.username).sort()).toEqual([
      "admin",
      "friend",
    ]);

    const created = await jsonRequest(
      runtime,
      "/api/v1/users/invites",
      "POST",
      {},
      admin.headers,
    );
    const invite = CreatedInviteSchema.parse(await created.json());
    const revoked = await jsonRequest(
      runtime,
      `/api/v1/users/invites/${invite.id}`,
      "DELETE",
      undefined,
      admin.headers,
    );
    expect(revoked.status).toBe(200);

    const lastAdmin = await jsonRequest(
      runtime,
      "/api/v1/users/1",
      "DELETE",
      undefined,
      admin.headers,
    );
    expect(lastAdmin.status).toBe(409);

    const deleted = await jsonRequest(
      runtime,
      `/api/v1/users/${friend.session.user.id}`,
      "DELETE",
      undefined,
      admin.headers,
    );
    expect(deleted.status).toBe(200);
  });

  test("admin can promote a user and cannot demote the last administrator", async () => {
    const runtime = await createRuntime();
    const admin = await setupAdmin(runtime);
    const friend = await inviteFriend(runtime, admin.headers);

    const denied = await jsonRequest(
      runtime,
      `/api/v1/users/${friend.session.user.id}`,
      "PATCH",
      { rank: "admin" },
      friend.headers,
    );
    expect(denied.status).toBe(403);

    const promoted = await jsonRequest(
      runtime,
      `/api/v1/users/${friend.session.user.id}`,
      "PATCH",
      { rank: "admin" },
      admin.headers,
    );
    expect(promoted.status).toBe(200);
    expect(await promoted.json()).toMatchObject({
      id: friend.session.user.id,
      username: "friend",
      rank: "admin",
    });

    const again = await jsonRequest(
      runtime,
      `/api/v1/users/${friend.session.user.id}`,
      "PATCH",
      { rank: "admin" },
      admin.headers,
    );
    expect(again.status).toBe(200);

    const me = await runtime.app.request("/api/v1/auth/me", {
      headers: { cookie: friend.headers.cookie },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      user: { rank: "admin" },
      capabilities: { canManageSettings: true },
    });

    const demoted = await jsonRequest(
      runtime,
      `/api/v1/users/${friend.session.user.id}`,
      "PATCH",
      { rank: "user" },
      admin.headers,
    );
    expect(demoted.status).toBe(200);
    expect(await demoted.json()).toMatchObject({ rank: "user" });

    const lastAdmin = await jsonRequest(
      runtime,
      "/api/v1/users/1",
      "PATCH",
      { rank: "user" },
      admin.headers,
    );
    expect(lastAdmin.status).toBe(409);
  });

  test("library views include createdByUserId and ownedByMe", async () => {
    const runtime = await createRuntime();
    const admin = await setupAdmin(runtime);
    const item = runtime.repositories.media.create({
      kind: "movie",
      tmdbId: 33,
      parentId: null,
      seasonNumber: null,
      episodeNumber: null,
      title: "Owned",
      year: 2000,
      posterUrl: null,
      status: "missing",
      monitorPolicy: "all",
      releaseDate: null,
      metadata: {},
    });
    const response = await runtime.app.request(`/api/v1/library/${item.id}`, {
      headers: { cookie: admin.headers.cookie },
    });
    expect(response.status).toBe(200);
    const body = LibraryItemSchema.parse(await response.json());
    expect(body.createdByUserId).toBe(1);
    expect(body.ownedByMe).toBe(true);
  });
});

async function createRuntime(): Promise<BackendRuntime> {
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

async function setupAdmin(runtime: BackendRuntime) {
  const response = await jsonRequest(runtime, "/api/v1/setup", "POST", {
    username: "admin",
    password: "a-correct-horse-battery-staple",
  });
  expect(response.status).toBe(201);
  const session = AuthSessionSchema.parse(await response.json());
  return { session, headers: sessionHeaders(response, session.csrfToken) };
}

async function inviteFriend(
  runtime: BackendRuntime,
  adminHeaders: Record<string, string>,
) {
  const created = await jsonRequest(
    runtime,
    "/api/v1/users/invites",
    "POST",
    {},
    adminHeaders,
  );
  expect(created.status).toBe(201);
  const invite = CreatedInviteSchema.parse(await created.json());
  const accepted = await jsonRequest(
    runtime,
    "/api/v1/invites/accept",
    "POST",
    {
      token: invite.token,
      username: "friend",
      password: "friend-pass",
    },
  );
  expect(accepted.status).toBe(201);
  const session = AuthSessionSchema.parse(await accepted.json());
  return { session, headers: sessionHeaders(accepted, session.csrfToken) };
}

function sessionHeaders(response: Response, csrfToken: string) {
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) throw new Error("Expected a session cookie");
  return {
    cookie: setCookie.split(";", 1)[0] ?? "",
    "x-csrf-token": csrfToken,
  };
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
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
