import { describe, expect, test } from "bun:test";

import {
  BOOTSTRAP_ADMIN_ID,
  classifyLibraryAdd,
  decide,
  effectiveDownloadRequester,
  effectiveMediaOwner,
  projectCapabilities,
  requireAllowed,
  requesterForAcquiredDownload,
  type Account,
  type Action,
  type Actor,
} from "./policy";
import { AppError } from "../core";

const adminAccount: Account = {
  id: 1,
  username: "admin",
  rank: "admin",
  createdAt: "2026-07-21T12:00:00.000Z",
  lastLoginAt: null,
};

const userAccount: Account = {
  id: 2,
  username: "friend",
  rank: "user",
  createdAt: "2026-07-21T12:00:00.000Z",
  lastLoginAt: null,
};

const admin: Actor = { sessionId: "sess-admin", account: adminAccount };
const user: Actor = { sessionId: "sess-user", account: userAccount };

const actions: Action[] = [
  { type: "manage_settings" },
  { type: "manage_users" },
  { type: "invite" },
  { type: "download" },
  { type: "mutate_media", ownerId: 2 },
  { type: "mutate_download", requesterId: 2 },
  { type: "change_own_password", targetId: 2 },
];

describe("decide", () => {
  test("admin is allowed every action", () => {
    for (const action of actions) {
      expect(decide(admin, action)).toEqual({ ok: true });
    }
    expect(decide(admin, { type: "mutate_media", ownerId: 99 })).toEqual({
      ok: true,
    });
    expect(decide(admin, { type: "change_own_password", targetId: 2 })).toEqual(
      { ok: true },
    );
  });

  test("user may download, mutate owned media and downloads, and change own password", () => {
    expect(decide(user, { type: "download" })).toEqual({ ok: true });
    expect(decide(user, { type: "mutate_media", ownerId: 2 })).toEqual({
      ok: true,
    });
    expect(decide(user, { type: "mutate_download", requesterId: 2 })).toEqual({
      ok: true,
    });
    expect(decide(user, { type: "change_own_password", targetId: 2 })).toEqual({
      ok: true,
    });
  });

  test("user is denied settings, people, and others' media, downloads, and passwords", () => {
    expect(decide(user, { type: "manage_settings" })).toEqual({
      ok: false,
      reason: "Administrator access is required to change settings",
    });
    expect(decide(user, { type: "manage_users" })).toEqual({
      ok: false,
      reason: "Administrator access is required to manage people",
    });
    expect(decide(user, { type: "invite" })).toEqual({
      ok: false,
      reason: "Administrator access is required to invite people",
    });
    expect(decide(user, { type: "mutate_media", ownerId: 1 })).toEqual({
      ok: false,
      reason: "You can only change titles you added",
    });
    expect(decide(user, { type: "mutate_download", requesterId: 1 })).toEqual({
      ok: false,
      reason: "You can only change downloads you started",
    });
    expect(decide(user, { type: "change_own_password", targetId: 1 })).toEqual({
      ok: false,
      reason: "You can only change your own password",
    });
  });
});

describe("requireAllowed", () => {
  test("returns for an allowed action", () => {
    expect(() => requireAllowed(user, { type: "download" })).not.toThrow();
  });

  test("throws forbidden 403 with the decision reason", () => {
    try {
      requireAllowed(user, { type: "manage_settings" });
      throw new Error("expected requireAllowed to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      if (!(error instanceof AppError)) return;
      expect(error.code).toBe("forbidden");
      expect(error.status).toBe(403);
      expect(error.message).toBe(
        "Administrator access is required to change settings",
      );
    }
  });
});

describe("projectCapabilities", () => {
  test("projects admin capabilities from rank", () => {
    expect(projectCapabilities("admin")).toEqual({
      rank: "admin",
      canManageSettings: true,
      canManageUsers: true,
      canInvite: true,
    });
  });

  test("projects user capabilities from rank", () => {
    expect(projectCapabilities("user")).toEqual({
      rank: "user",
      canManageSettings: false,
      canManageUsers: false,
      canInvite: false,
    });
  });
});

describe("classifyLibraryAdd", () => {
  test("new titles are downloads", () => {
    expect(classifyLibraryAdd(undefined)).toEqual({ type: "download" });
  });

  test("existing titles are mutate_media of the first owner", () => {
    expect(classifyLibraryAdd({ createdByUserId: 4 })).toEqual({
      type: "mutate_media",
      ownerId: 4,
    });
  });
});

describe("ownership helpers", () => {
  test("effectiveMediaOwner returns the column", () => {
    expect(effectiveMediaOwner({ createdByUserId: 7 })).toBe(7);
  });

  test("effectiveDownloadRequester returns the column or the bootstrap admin", () => {
    expect(effectiveDownloadRequester({ requestedByUserId: 3 })).toBe(3);
    expect(effectiveDownloadRequester({ requestedByUserId: null })).toBe(
      BOOTSTRAP_ADMIN_ID,
    );
  });

  test("acquired downloads copy the media owner", () => {
    expect(requesterForAcquiredDownload({ createdByUserId: 9 })).toBe(9);
  });
});
