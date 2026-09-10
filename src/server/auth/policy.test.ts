import { describe, expect, test } from "bun:test";

import {
  projectCapabilities,
  requireAdmin,
  requireOwner,
  type Account,
  type Actor,
} from "./policy";
import { AppError } from "../core";

const admin: Actor = {
  sessionId: "sess-admin",
  account: {
    id: 1,
    username: "admin",
    rank: "admin",
    createdAt: "2026-07-21T12:00:00.000Z",
    lastLoginAt: null,
  } satisfies Account,
};

const user: Actor = {
  sessionId: "sess-user",
  account: {
    id: 2,
    username: "friend",
    rank: "user",
    createdAt: "2026-07-21T12:00:00.000Z",
    lastLoginAt: null,
  } satisfies Account,
};

describe("requireAdmin", () => {
  test("allows administrators", () => {
    expect(() => requireAdmin(admin)).not.toThrow();
  });

  test("forbids users with the supplied message", () => {
    try {
      requireAdmin(user, "Administrator access is required to change settings");
      throw new Error("expected requireAdmin to throw");
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

describe("requireOwner", () => {
  test("allows the owner and any administrator", () => {
    expect(() => requireOwner(user, 2, "denied")).not.toThrow();
    expect(() => requireOwner(admin, 99, "denied")).not.toThrow();
  });

  test("forbids a user who does not own the row", () => {
    try {
      requireOwner(user, 1, "You can only change titles you added");
      throw new Error("expected requireOwner to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      if (!(error instanceof AppError)) return;
      expect(error.message).toBe("You can only change titles you added");
    }
  });
});

describe("projectCapabilities", () => {
  test("admin can manage settings", () => {
    expect(projectCapabilities("admin")).toEqual({
      rank: "admin",
      canManageSettings: true,
    });
  });

  test("user cannot manage settings", () => {
    expect(projectCapabilities("user")).toEqual({
      rank: "user",
      canManageSettings: false,
    });
  });
});
