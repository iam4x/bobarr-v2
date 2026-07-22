import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const fakeServicesPort = 3101;
const appControlPort = 3102;
const e2eRoot = "/tmp/bobarr-e2e";
const appControlToken = "bobarr-e2e-supervisor-control-token";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "bun run e2e/fake-services.ts",
      env: {
        ...process.env,
        FAKE_SERVICES_PORT: String(fakeServicesPort),
      },
      reuseExistingServer: false,
      timeout: 15_000,
      url: `http://127.0.0.1:${fakeServicesPort}/health`,
    },
    {
      command: "bun run e2e/app-server.ts",
      env: {
        ...process.env,
        BOBARR_CONFIG_DIR: `${e2eRoot}/config`,
        BOBARR_DATABASE_PATH: `${e2eRoot}/config/bobarr.sqlite`,
        BOBARR_E2E_CONTROL_PORT: String(appControlPort),
        BOBARR_E2E_CONTROL_TOKEN: appControlToken,
        BOBARR_E2E_ROOT: e2eRoot,
        BOBARR_JACKETT_API_KEY: "bobarr-e2e-jackett-key",
        BOBARR_JACKETT_URL: `http://127.0.0.1:${fakeServicesPort}/jackett`,
        BOBARR_JOBS_DATABASE_PATH: `${e2eRoot}/config/jobs.sqlite`,
        BOBARR_PUBLIC_URL: `http://127.0.0.1:${port}`,
        BOBARR_SHUTDOWN_TIMEOUT_MS: "4000",
        BOBARR_TMDB_URL: `http://127.0.0.1:${fakeServicesPort}/tmdb/3`,
        BOBARR_TRANSMISSION_URL: `http://127.0.0.1:${fakeServicesPort}/transmission/rpc`,
        NODE_ENV: "test",
        PORT: String(port),
        TMDB_API_KEY: "bobarr-e2e-tmdb-key",
      },
      reuseExistingServer: false,
      timeout: 30_000,
      url: `http://127.0.0.1:${port}/health/ready`,
    },
  ],
  projects: [
    {
      name: "phone",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
    {
      name: "tablet",
      use: { ...devices["iPad Mini"], browserName: "chromium" },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
