import { describe, expect, test } from "bun:test";

import { createEncryptionKey, parseBackendConfig } from "./server/config";

describe("runtime configuration", () => {
  test("uses the mounted config directory and public origin", () => {
    const config = parseBackendConfig({
      NODE_ENV: "production",
      BOBARR_CONFIG_DIR: "/config",
      BOBARR_MASTER_KEY: createEncryptionKey(),
      BOBARR_PUBLIC_URL: "https://bobarr.example.test",
    });

    expect(config.databasePath).toBe("/config/bobarr.sqlite");
    expect(config.allowedOrigin).toBe("https://bobarr.example.test");
    expect(config.sessionCookieSecure).toBe(true);
  });
});
