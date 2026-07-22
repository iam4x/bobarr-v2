import type { BackendConfig } from "../config";
import type { Clock } from "../core";
import type { PasswordHasher } from "./passwords";

import { afterEach, describe, expect, test } from "bun:test";

import { AuthService } from "./auth-service";
import { createEncryptionKey } from "../config";
import { createRepositories, openBackendDatabase } from "../db";

const databases: Awaited<ReturnType<typeof openBackendDatabase>>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("authentication throttling", () => {
  test("atomically locks concurrent failures for the administrator", async () => {
    const fixture = await createFixture();
    await fixture.service.setup({
      username: "admin",
      password: "correct-horse-battery-staple",
    });

    const attempts = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        fixture.service.login(
          { username: "admin", password: "incorrect-password" },
          { ipAddress: "192.0.2.10" },
        ),
      ),
    );
    const errors = attempts.map((attempt) =>
      attempt.status === "rejected"
        ? (attempt.reason as { code?: string }).code
        : "fulfilled",
    );
    expect(errors.filter((code) => code === "unauthorized")).toHaveLength(2);
    expect(errors.filter((code) => code === "account_locked")).toHaveLength(1);
    expect(fixture.repositories.auth.getAdmin()).toMatchObject({
      failedLoginCount: 3,
      lockedUntil: fixture.now + 60_000,
    });
  });

  test("bounds and locks unknown-account attempts without extra hash work", async () => {
    const fixture = await createFixture();
    await fixture.service.setup({
      username: "admin",
      password: "correct-horse-battery-staple",
    });

    for (const expectedCode of [
      "unauthorized",
      "unauthorized",
      "account_locked",
    ]) {
      await expect(
        fixture.service.login(
          { username: "nobody", password: "incorrect-password" },
          { ipAddress: "192.0.2.20" },
        ),
      ).rejects.toMatchObject({ code: expectedCode });
    }
    expect(fixture.passwordHasher.verifyCalls).toBe(3);
    await expect(
      fixture.service.login(
        { username: "nobody", password: "incorrect-password" },
        { ipAddress: "192.0.2.20" },
      ),
    ).rejects.toMatchObject({ code: "account_locked" });
    expect(fixture.passwordHasher.verifyCalls).toBe(3);
  });
});

async function createFixture() {
  const database = await openBackendDatabase(":memory:");
  databases.push(database);
  const now = Date.parse("2026-07-21T12:00:00.000Z");
  const clock: Clock = { now: () => new Date(now) };
  const repositories = createRepositories(database, clock);
  const passwordHasher = new TestPasswordHasher();
  const config: BackendConfig = {
    environment: "test",
    version: "test",
    databasePath: ":memory:",
    encryptionKey: createEncryptionKey(),
    sessionCookieName: "bobarr_session",
    sessionTtlSeconds: 3_600,
    sessionCookieSecure: false,
    loginFailureLimit: 3,
    loginLockSeconds: 60,
  };
  const service = await AuthService.create({
    repository: repositories.auth,
    config,
    passwordHasher,
    dummyPasswordHash: "hash:dummy-password",
    clock,
  });
  return { service, repositories, passwordHasher, now };
}

class TestPasswordHasher implements PasswordHasher {
  verifyCalls = 0;

  async hash(password: string): Promise<string> {
    return `hash:${password}`;
  }

  async verify(password: string, hash: string): Promise<boolean> {
    this.verifyCalls += 1;
    await Promise.resolve();
    return hash === `hash:${password}`;
  }
}
