import { describe, expect, test } from "bun:test";

import { NO_CACHE_HEADERS, SERVICE_WORKER_SOURCE } from "./config";

describe("PWA configuration", () => {
  test("uses a standalone root-scoped manifest with install icons", async () => {
    const manifest = JSON.parse(
      await Bun.file(
        new URL("../manifest.webmanifest", import.meta.url),
      ).text(),
    ) as {
      display: string;
      start_url: string;
      scope: string;
      icons: Array<{ sizes: string }>;
    };

    expect(manifest).toMatchObject({
      display: "standalone",
      start_url: "/",
      scope: "/",
    });
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual([
      "192x192",
      "512x512",
    ]);
  });

  test("always uses the network and never creates an asset cache", () => {
    expect(SERVICE_WORKER_SOURCE).toContain('cache: "no-store"');
    expect(SERVICE_WORKER_SOURCE).toContain("caches.delete");
    expect(SERVICE_WORKER_SOURCE).not.toContain("caches.open");
    expect(NO_CACHE_HEADERS["cache-control"]).toContain("no-store");
  });

  test("locks the installed-app viewport and opts into safe-area layout", async () => {
    const html = await Bun.file(
      new URL("../index.html", import.meta.url),
    ).text();

    expect(html).toContain("maximum-scale=1");
    expect(html).toContain("user-scalable=no");
    expect(html).toContain("viewport-fit=cover");
  });
});
