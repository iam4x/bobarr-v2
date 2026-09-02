import type { APIRequestContext, CDPSession, Page } from "@playwright/test";

import { expect } from "@playwright/test";

export const administrator = {
  username: "e2e-admin",
  password: "e2e-password-2026",
};

export const fakeServicesUrl = "http://127.0.0.1:3101";
export const appControlUrl = "http://127.0.0.1:3102";
export const mediaRoot = "/tmp/bobarr-e2e/media";
const appControlToken = "bobarr-e2e-supervisor-control-token";
const touchSessions = new WeakMap<Page, CDPSession>();

export async function dragTouch(
  page: Page,
  input: {
    from: { x: number; y: number };
    to: { x: number; y: number };
    steps?: number;
  },
): Promise<void> {
  let session = touchSessions.get(page);
  if (!session) {
    session = await page.context().newCDPSession(page);
    touchSessions.set(page, session);
  }
  const steps = input.steps ?? 8;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [input.from],
  });
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: input.from.x + (input.to.x - input.from.x) * progress,
          y: input.from.y + (input.to.y - input.from.y) * progress,
        },
      ],
    });
    await page.waitForTimeout(16);
  }
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

export interface CatalogSearchPayload {
  items: Array<{
    tmdbId: number;
    kind: "movie" | "series";
    title: string;
  }>;
}

export interface DownloadPayload {
  id: string;
  mediaId?: string | null;
  title: string;
  state: string;
}

export interface FakeServicesState {
  jackettMode: "ready" | "empty" | "degraded";
  seasonScenario: "standard" | "partially-aired";
  emptyEpisodes: number[];
  tmdbDegraded: boolean;
  tmdbAmbiguous: boolean;
  transmissionDegraded: boolean;
  torrents: number;
  torrentAddRequests: number;
}

export interface AppSupervisorState {
  generation: number;
  pid: number;
  state: "ready";
  unexpectedExitCode: null;
}

export async function authenticate(page: Page): Promise<void> {
  await page.goto("/");
  const setupUsername = page.getByLabel("Administrator username");
  const loginHeading = page.getByRole("heading", { name: "Sign in to Bobarr" });
  await setupUsername.or(loginHeading).first().waitFor();

  if (await setupUsername.isVisible()) {
    await setupUsername.fill(administrator.username);
    await page.locator('input[name="password"]').fill(administrator.password);
    await page
      .locator('input[name="confirmation"]')
      .fill(administrator.password);
    await page.getByRole("button", { name: "Create administrator" }).click();
  } else if (await loginHeading.isVisible()) {
    await signIn(page);
  }

  await expect(page).toHaveURL(/\/(?:discover|settings)/);
  await configureStorage(page);
}

export async function signIn(page: Page): Promise<void> {
  await page
    .getByLabel("Username", { exact: true })
    .fill(administrator.username);
  await page.locator('input[name="password"]').fill(administrator.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/discover/);
}

export async function controlFakeServices(
  request: APIRequestContext,
  input: {
    jackettMode?: "ready" | "empty" | "degraded";
    seasonScenario?: "standard" | "partially-aired";
    emptyEpisodes?: number[];
    tmdbDegraded?: boolean;
    tmdbAmbiguous?: boolean;
    transmissionDegraded?: boolean;
    restartTransmission?: boolean;
    completeMatching?: string;
    resetTorrents?: boolean;
  },
): Promise<FakeServicesState> {
  const response = await request.post(`${fakeServicesUrl}/__control`, {
    data: input,
  });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<FakeServicesState>;
}

export async function restartBobarr(
  request: APIRequestContext,
): Promise<AppSupervisorState> {
  const response = await request.post(`${appControlUrl}/__control/restart`, {
    headers: { "x-bobarr-e2e-control-token": appControlToken },
  });
  const body = (await response.json()) as AppSupervisorState & {
    error?: string;
  };
  expect(response.ok(), body.error).toBe(true);
  expect(body).toMatchObject({
    state: "ready",
    unexpectedExitCode: null,
  });
  return body;
}

export async function apiJson<T>(
  page: Page,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  return page.evaluate(
    async ({ requestPath, method, body }) => {
      const headers = new Headers({ accept: "application/json" });
      if (body !== undefined) headers.set("content-type", "application/json");
      const csrfToken = sessionStorage.getItem("bobarr.csrf");
      if (csrfToken && !["GET", "HEAD"].includes(method)) {
        headers.set("x-csrf-token", csrfToken);
      }
      const response = await fetch(requestPath, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `${method} ${requestPath} failed: ${response.status} ${text}`,
        );
      }
      return text ? JSON.parse(text) : null;
    },
    {
      requestPath: path,
      method: options.method ?? "GET",
      body: options.body,
    },
  ) as Promise<T>;
}

export async function searchAndOpen(page: Page, title: string): Promise<void> {
  await page.goto("/search");
  const search = page.getByLabel("Search movies and shows");
  await search.fill(title);
  await search.press("Enter");
  await page.getByRole("button", { name: `View ${title}` }).click();
  await expect(page.getByRole("dialog")).toContainText(title);
}

export async function openLibraryCard(
  page: Page,
  title: string,
): Promise<void> {
  const card = page.locator(".library-card").filter({ hasText: title });
  const hitArea = card.getByRole("button", {
    name: `Open ${title} details`,
  });
  await expect(hitArea).toBeVisible();
  await hitArea.click({ position: { x: 8, y: 8 } });
}

export async function waitForLibraryState(
  page: Page,
  title: string,
  state: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const result = await apiJson<{
          items: Array<{ title: string; status: string }>;
        }>(page, "/api/v1/library?limit=100");
        return result.items.find((item) => item.title === title)?.status;
      },
      { timeout: 12_000 },
    )
    .toBe(state);
}

export async function waitForAcquisitionSettled(
  page: Page,
  title: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const library = await apiJson<{
          items: Array<{ id: string; kind: string; title: string }>;
        }>(page, "/api/v1/library?limit=100");
        const root = library.items.find((item) => item.title === title);
        if (!root) return false;
        let targetIds = [root.id];
        if (root.kind === "series") {
          const children = await apiJson<{
            items: Array<{ id: string; kind: string }>;
          }>(
            page,
            `/api/v1/library?limit=100&parentId=${encodeURIComponent(root.id)}`,
          );
          targetIds = children.items
            .filter((item) => item.kind === "season")
            .map((item) => item.id);
          if (targetIds.length === 0) return false;
        }
        const result = await apiJson<{
          jobs: Array<{
            kind: string;
            status: string;
            payload: Record<string, unknown>;
          }>;
        }>(page, "/api/v1/jobs?limit=100");
        return targetIds.every((id) =>
          result.jobs.some(
            (job) =>
              job.kind === "media.acquire.v1" &&
              job.payload["mediaId"] === id &&
              ["completed", "failed", "cancelled"].includes(job.status),
          ),
        );
      },
      { timeout: 12_000 },
    )
    .toBe(true);
}

export async function waitForDownloadState(
  page: Page,
  title: string,
  state: string,
): Promise<DownloadPayload> {
  let matched: DownloadPayload | undefined;
  await expect
    .poll(
      async () => {
        const result = await apiJson<{ downloads: DownloadPayload[] }>(
          page,
          "/api/v1/downloads",
        );
        matched = result.downloads.find((download) =>
          download.title.includes(title),
        );
        return matched?.state;
      },
      { timeout: 12_000 },
    )
    .toBe(state);
  if (!matched) throw new Error(`Download ${title} was not found`);
  return matched;
}

async function configureStorage(page: Page): Promise<void> {
  await apiJson(page, "/api/v1/settings", {
    method: "PATCH",
    body: {
      storage: {
        downloadsPath: `${mediaRoot}/downloads`,
        moviesPath: `${mediaRoot}/movies`,
        televisionPath: `${mediaRoot}/tv`,
        organizationStrategy: "hardlink",
      },
    },
  });
}
