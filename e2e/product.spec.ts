import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import {
  apiJson,
  authenticate,
  controlFakeServices,
  mediaRoot,
  restartBobarr,
  searchAndOpen,
  signIn,
  waitForAcquisitionSettled,
  waitForDownloadState,
  waitForLibraryState,
  type CatalogSearchPayload,
} from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ request }) => {
  await controlFakeServices(request, {
    jackettMode: "ready",
    seasonScenario: "standard",
    emptyEpisodes: [],
    tmdbAmbiguous: false,
    tmdbDegraded: false,
    transmissionDegraded: false,
  });
});

test("completes first-run setup and a real logout/login round trip", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/settings#maintenance");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to Bobarr" }),
  ).toBeVisible();
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "Discover something remarkable" }),
  ).toBeVisible();
});

test("searches while typing and reuses session-cached TMDB results", async ({
  page,
}, testInfo) => {
  await authenticate(page);
  await page.goto("/search");
  const firstTitle = `E2E Cached Search ${testInfo.project.name}`;
  const secondTitle = `E2E Alternate Search ${testInfo.project.name}`;
  let firstTitleRequests = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname === "/api/v1/catalog/search" &&
      url.searchParams.get("query") === firstTitle
    ) {
      firstTitleRequests += 1;
    }
  });

  const search = page.getByRole("searchbox", {
    name: "Search movies and shows",
  });
  await search.fill(firstTitle);
  await expect(
    page.getByRole("button", { name: `View ${firstTitle}` }),
  ).toBeVisible();
  await search.fill(secondTitle);
  await expect(
    page.getByRole("button", { name: `View ${secondTitle}` }),
  ).toBeVisible();
  await search.fill(firstTitle);
  await expect(
    page.getByRole("button", { name: `View ${firstTitle}` }),
  ).toBeVisible();

  expect(firstTitleRequests).toBe(1);
});

test("builds, applies, and removes responsive Discover filters", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/discover");

  await page.getByRole("button", { name: /^Filters/ }).click();
  const filters = page.getByRole("dialog", { name: "Find your next watch" });
  await expect(filters).toBeVisible();
  const closeFilters = filters.getByRole("button", { name: "Close filters" });
  await expect(closeFilters).toBeFocused();
  await closeFilters.press("Shift+Tab");
  await expect(
    filters.getByRole("button", { name: "Apply filters" }),
  ).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("hidden");
  await filters.getByLabel("Sort by").selectOption("vote_average.desc");
  await expect(filters.getByLabel("Minimum votes")).toHaveValue("");
  await filters.getByLabel("Drama").check();
  await filters.getByLabel("Country of origin").selectOption("FR");
  await filters.getByLabel("Original language").selectOption("fr");
  await filters.getByLabel("Minimum length").selectOption("90");
  await filters.getByLabel("Minimum rating").selectOption("7.5");

  const filteredRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/api/v1/catalog/discover" &&
      url.searchParams.get("sort") === "vote_average.desc" &&
      url.searchParams.get("genres") === "18"
    );
  });
  await filters.getByRole("button", { name: "Apply filters" }).click();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("");
  const appliedUrl = new URL((await filteredRequest).url());
  expect(appliedUrl.searchParams.has("voteCountMin")).toBe(false);
  expect(appliedUrl.searchParams.get("originCountry")).toBe("FR");
  expect(appliedUrl.searchParams.get("originalLanguage")).toBe("fr");
  expect(appliedUrl.searchParams.get("runtimeMin")).toBe("90");
  expect(appliedUrl.searchParams.get("ratingMin")).toBe("7.5");

  const applied = page.getByLabel("Applied filters");
  await expect(applied).toContainText("Highest rated");
  await expect(applied).toContainText("200+ votes");
  await expect(applied).toContainText("Drama");
  await expect(applied).toContainText("France");
  await expect(applied).toContainText("Language: French");
  await expect(applied).toContainText("Length: 90 min");
  await expect(applied).toContainText("Rated 7.5+");

  const noFloorRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/api/v1/catalog/discover" &&
      url.searchParams.get("voteCountMin") === "0"
    );
  });
  await applied
    .getByRole("button", { name: "Remove 200+ votes filter" })
    .click();
  await noFloorRequest;
  await expect(applied).not.toContainText("200+ votes");

  await applied.getByRole("button", { name: "Remove Drama filter" }).click();
  await expect(applied).not.toContainText("Drama");

  await page.getByRole("button", { name: "Shows" }).click();
  await page.getByRole("button", { name: /^Filters/ }).click();
  const showFilters = page.getByRole("dialog", {
    name: "Find your next watch",
  });
  await expect(
    showFilters.getByRole("option", { name: "Highest box office" }),
  ).toHaveCount(0);
});

test("monitors a movie, manually grabs a Jackett release, and shows it in Activity", async ({
  page,
  request,
}, testInfo) => {
  await authenticate(page);
  await controlFakeServices(request, { jackettMode: "ready" });
  const title = `E2E Movie ${testInfo.project.name}`;

  await searchAndOpen(page, title);
  await page.getByRole("button", { name: "Add & search manually" }).click();
  await expect(page.getByRole("status")).toContainText(
    "without starting a download",
  );
  const pendingLibrary = await apiJson<{
    items: Array<{
      id: string;
      title: string;
      metadata: Record<string, unknown>;
    }>;
  }>(page, "/api/v1/library?limit=100");
  const pendingMovie = pendingLibrary.items.find(
    (item) => item.title === title,
  );
  expect(pendingMovie?.metadata["manualSearchPending"]).toBe(true);
  const pendingJobs = await apiJson<{
    jobs: Array<{ kind: string; payload: Record<string, unknown> }>;
  }>(page, "/api/v1/jobs?limit=100");
  expect(
    pendingJobs.jobs.some(
      (job) =>
        job.kind === "media.acquire.v1" &&
        job.payload["mediaId"] === pendingMovie?.id,
    ),
  ).toBe(false);

  const release = page
    .locator(".release-card")
    .filter({ hasText: `${title}.2024.1080p` });
  await expect(release).toContainText("Bobarr E2E Indexer");
  await expect(release).toContainText("42 seeders");
  await release.getByRole("button", { name: "Grab" }).click();
  await expect(page.getByRole("status")).toContainText("Release queued");

  await page.goto("/activity");
  await expect(
    page.getByRole("heading", {
      name: new RegExp(`^${escapeRegex(title)}\\.2024`),
    }),
  ).toBeVisible();
  const initialDownload = await waitForDownloadState(
    page,
    title,
    "downloading",
  );
  const library = await apiJson<{
    items: Array<{ id: string; title: string; status: string }>;
  }>(page, "/api/v1/library?limit=100");
  const movie = library.items.find((item) => item.title === title);
  expect(movie).toBeDefined();

  const engineBeforeRestart = await controlFakeServices(request, {});
  const supervisor = await restartBobarr(request);
  expect(supervisor.generation).toBeGreaterThan(1);
  await page.reload({ waitUntil: "domcontentloaded" });
  const recoveredDownload = await waitForDownloadState(
    page,
    title,
    "downloading",
  );
  expect(recoveredDownload.id).toBe(initialDownload.id);
  const engineAfterRestart = await controlFakeServices(request, {});
  expect(engineAfterRestart.torrents).toBe(engineBeforeRestart.torrents);
  expect(engineAfterRestart.torrentAddRequests).toBe(
    engineBeforeRestart.torrentAddRequests,
  );

  await controlFakeServices(request, { jackettMode: "empty" });
  const jobsBeforeRemoval = await apiJson<{
    jobs: Array<{ id: string }>;
  }>(page, "/api/v1/jobs?limit=100");
  const knownJobIds = new Set(jobsBeforeRemoval.jobs.map((job) => job.id));
  const removal = await apiJson<{ removed: boolean; dataDeleted: boolean }>(
    page,
    `/api/v1/downloads/${initialDownload.id}`,
    { method: "DELETE", body: { deleteData: false } },
  );
  expect(removal).toEqual({ removed: true, dataDeleted: false });
  await waitForLibraryState(page, title, "unmonitored");
  await page.waitForTimeout(750);
  const jobsAfterRemoval = await apiJson<{
    jobs: Array<{
      id: string;
      kind: string;
      payload: Record<string, unknown>;
    }>;
  }>(page, "/api/v1/jobs?limit=100");
  expect(
    jobsAfterRemoval.jobs.some(
      (job) =>
        !knownJobIds.has(job.id) &&
        job.kind === "media.acquire.v1" &&
        job.payload["mediaId"] === movie!.id,
    ),
  ).toBe(false);

  await controlFakeServices(request, { jackettMode: "ready" });
  await apiJson(page, `/api/v1/library/${movie!.id}`, {
    method: "PATCH",
    body: { monitorPolicy: "all" },
  });
  const retryDownload = await waitForDownloadState(page, title, "downloading");
  expect(retryDownload.id).not.toBe(initialDownload.id);
  await controlFakeServices(request, { completeMatching: title });
  await apiJson(page, "/api/v1/jobs", {
    method: "POST",
    body: { kind: "maintenance.reconcile.v1", payload: {} },
  });
  await waitForLibraryState(page, title, "available");
  const organized = `${mediaRoot}/movies/${title} (2024)/${title} (2024).mkv`;
  await expect(access(organized)).resolves.toBeUndefined();

  await page.goto("/library/movies");
  const card = page.locator(".library-card").filter({ hasText: title });
  await card.getByRole("button", { name: `Open ${title} details` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Remove from library" }).click();
  await dialog.getByLabel("Delete organized library files").check();
  await dialog.getByLabel("Remove torrent from Transmission").check();
  await dialog.getByLabel("Delete original download data").check();
  await dialog
    .getByRole("button", { name: "Confirm removal", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  const libraryAfterRemoval = await apiJson<{
    items: Array<{ id: string }>;
  }>(page, "/api/v1/library?limit=100");
  expect(libraryAfterRemoval.items.some((item) => item.id === movie!.id)).toBe(
    false,
  );
  await expect(access(organized)).rejects.toThrow();
});

test("shows responsive library card metadata during and after acquisition", async ({
  page,
  request,
}, testInfo) => {
  await authenticate(page);
  await controlFakeServices(request, { jackettMode: "ready" });
  const title = `E2E Library Card With A Deliberately Long Location ${testInfo.project.name}`;

  await searchAndOpen(page, title);
  await page.getByRole("button", { name: "Add to library" }).click();
  const download = await waitForDownloadState(page, title, "downloading");

  await page.goto("/library/movies");
  let card = page.locator(".library-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card.getByLabel("TMDB rating 8.2 out of 10")).toBeVisible();
  await expect(card.locator(".library-card__download")).toContainText("42%");
  await expect(
    card.getByRole("progressbar", { name: `${title} download progress` }),
  ).toHaveAttribute("aria-valuenow", "42");
  const downloadLocation = card.locator(".library-card__location");
  await expect(downloadLocation).toContainText("Downloading to");
  await expect(downloadLocation).toHaveAttribute(
    "title",
    `${mediaRoot}/downloads/${download.id}`,
  );
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await controlFakeServices(request, { completeMatching: title });
  await apiJson(page, "/api/v1/jobs", {
    method: "POST",
    body: { kind: "maintenance.reconcile.v1", payload: {} },
  });
  await waitForLibraryState(page, title, "available");

  await page.reload();
  card = page.locator(".library-card").filter({ hasText: title });
  const organizedSuffix = `/bobarr-e2e/media/movies/${title} (2024)/${title} (2024).mkv`;
  const organizedLocation = card.locator(".library-card__location");
  await expect(organizedLocation).toContainText("In library");
  await expect(organizedLocation).toHaveAttribute(
    "title",
    new RegExp(`${escapeRegex(organizedSuffix)}$`),
  );
  await expect(card.getByLabel("TMDB rating 8.2 out of 10")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("chooses a release for a missing movie from library management", async ({
  page,
  request,
}, testInfo) => {
  await authenticate(page);
  await controlFakeServices(request, { jackettMode: "empty" });
  const title = `E2E Retry Movie ${testInfo.project.name}`;
  await searchAndOpen(page, title);
  await page.getByRole("button", { name: "Add to library" }).click();
  await waitForAcquisitionSettled(page, title);
  await waitForLibraryState(page, title, "missing");
  await controlFakeServices(request, { jackettMode: "ready" });

  await page.goto("/library/movies");
  const card = page.locator(".library-card").filter({ hasText: title });
  await card.getByRole("button", { name: `Open ${title} details` }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Search releases manually" })
    .click();
  const queryInput = dialog.getByLabel("Jackett search query");
  await expect(queryInput).toHaveValue(`${title} 2024`);
  await queryInput.fill(`${title} alternate`);
  await dialog.getByRole("button", { name: "Search Jackett" }).click();
  const release = dialog
    .locator(".release-card")
    .filter({ hasText: `${title} alternate.2024.1080p` });
  await expect(release).toContainText("Bobarr E2E Indexer");
  await release.getByRole("button", { name: "Grab" }).click();
  await expect(dialog.getByRole("status")).toContainText("Release queued");
  const original = await waitForDownloadState(
    page,
    `${title} alternate`,
    "downloading",
  );

  await page.goto("/library/movies");
  const downloadingCard = page
    .locator(".library-card")
    .filter({ hasText: title });
  await downloadingCard
    .getByRole("button", { name: `Open ${title} details` })
    .click();
  const replacementDialog = page.getByRole("dialog");
  await replacementDialog
    .getByRole("button", { name: "Search releases manually" })
    .click();
  const replacementQuery = replacementDialog.getByLabel("Jackett search query");
  await replacementQuery.fill(`${title} healthier swarm`);
  await replacementDialog
    .getByRole("button", { name: "Search Jackett" })
    .click();
  const replacement = replacementDialog
    .locator(".release-card")
    .filter({ hasText: `${title} healthier swarm.2024.1080p` });
  await expect(replacement).toBeVisible();
  await expect(replacementDialog.getByRole("note")).toContainText(
    "explicit replacement",
  );
  await replacement.getByRole("button", { name: "Replace" }).click();
  await expect(replacementDialog.getByRole("status")).toContainText(
    "Replacement queued",
  );
  const healthier = await waitForDownloadState(
    page,
    `${title} healthier swarm`,
    "downloading",
  );
  expect(healthier.id).not.toBe(original.id);
  const downloads = await apiJson<{
    downloads: Array<{ id: string }>;
  }>(page, "/api/v1/downloads?limit=100");
  expect(
    downloads.downloads.some((download) => download.id === original.id),
  ).toBe(false);
});

test("acquires and organizes two monitored TV seasons", async ({
  page,
  request,
}, testInfo) => {
  await authenticate(page);
  await controlFakeServices(request, { jackettMode: "empty" });
  const title = `E2E Series ${testInfo.project.name}`;
  const search = await apiJson<CatalogSearchPayload>(
    page,
    `/api/v1/catalog/search?query=${encodeURIComponent(title)}&kind=series`,
  );
  const item = search.items[0];
  expect(item?.title).toBe(title);
  await apiJson(page, "/api/v1/library", {
    method: "POST",
    body: {
      tmdbId: item!.tmdbId,
      kind: "series",
      monitorPolicy: "all",
      seasonNumbers: [1, 2],
      includeFutureSeasons: false,
    },
  });
  await waitForAcquisitionSettled(page, title);
  await waitForLibraryState(page, title, "missing");

  await controlFakeServices(request, { jackettMode: "ready" });
  await page.goto("/library/shows");
  const card = page.locator(".library-card").filter({ hasText: title });
  await card.getByRole("button", { name: `Open ${title} details` }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: /Search any release manually/ })
    .click();
  await expect(dialog.getByLabel("Season", { exact: true })).toHaveValue("2");
  await dialog.getByLabel("Season", { exact: true }).selectOption("1");
  const seasonOneRelease = dialog
    .locator(".release-card")
    .filter({ hasText: ".S01.1080p" });
  await expect(seasonOneRelease).toBeVisible();
  await seasonOneRelease.getByRole("button", { name: "Grab" }).click();
  await waitForDownloadState(page, `${title}.2024.S01`, "downloading");

  await dialog.getByLabel("Season", { exact: true }).selectOption("2");
  const seasonTwoRelease = dialog
    .locator(".release-card")
    .filter({ hasText: ".S02.1080p" });
  await expect(seasonTwoRelease).toBeVisible();
  await seasonTwoRelease.getByRole("button", { name: "Grab" }).click();
  await waitForDownloadState(page, `${title}.2024.S02`, "downloading");

  await controlFakeServices(request, { completeMatching: title });
  await apiJson(page, "/api/v1/jobs", {
    method: "POST",
    body: { kind: "maintenance.reconcile.v1", payload: {} },
  });
  await waitForLibraryState(page, title, "available");

  const library = await apiJson<{
    items: Array<{ id: string; title: string }>;
  }>(page, "/api/v1/library?limit=100");
  const series = library.items.find((entry) => entry.title === title);
  expect(series).toBeDefined();
  const seasons = await apiJson<{
    items: Array<{ seasonNumber: number; status: string }>;
  }>(
    page,
    `/api/v1/library?limit=100&parentId=${encodeURIComponent(series!.id)}`,
  );
  expect(
    seasons.items
      .map((season) => ({
        seasonNumber: season.seasonNumber,
        status: season.status,
      }))
      .sort((left, right) => left.seasonNumber - right.seasonNumber),
  ).toEqual([
    { seasonNumber: 1, status: "available" },
    { seasonNumber: 2, status: "available" },
  ]);

  for (const season of [1, 2]) {
    for (const episode of [1, 2]) {
      const seasonNumber = String(season).padStart(2, "0");
      const episodeNumber = String(episode).padStart(2, "0");
      const organized = `${mediaRoot}/tv/${title} (2024)/Season ${seasonNumber}/${title} - S${seasonNumber}E${episodeNumber}.mkv`;
      await expect(access(organized)).resolves.toBeUndefined();
    }
  }
});

test("explains a partially aired TV season episode by episode", async ({
  page,
  request,
}, testInfo) => {
  await authenticate(page);
  await controlFakeServices(request, {
    jackettMode: "ready",
    seasonScenario: "partially-aired",
    emptyEpisodes: [3, 4, 6],
  });
  const title = `E2E Partially Aired Series ${testInfo.project.name}`;
  const search = await apiJson<CatalogSearchPayload>(
    page,
    `/api/v1/catalog/search?query=${encodeURIComponent(title)}&kind=series`,
  );
  const item = search.items[0]!;
  await apiJson(page, "/api/v1/library", {
    method: "POST",
    body: {
      tmdbId: item.tmdbId,
      kind: "series",
      monitorPolicy: "selected",
      seasonNumbers: [1],
      includeFutureSeasons: false,
    },
  });

  await waitForDownloadState(page, `${title}.2024.S01E01`, "downloading");
  await waitForDownloadState(page, `${title}.2024.S01E02`, "downloading");
  await controlFakeServices(request, { completeMatching: "S01E01" });
  await apiJson(page, "/api/v1/jobs", {
    method: "POST",
    body: { kind: "maintenance.reconcile.v1", payload: {} },
  });

  let seasonId = "";
  await expect
    .poll(
      async () => {
        const library = await apiJson<{
          items: Array<{ id: string; title: string }>;
        }>(page, "/api/v1/library?limit=100");
        const series = library.items.find((entry) => entry.title === title);
        if (!series) return "series-missing";
        const seasons = await apiJson<{
          items: Array<{ id: string; seasonNumber: number }>;
        }>(
          page,
          `/api/v1/library?limit=100&parentId=${encodeURIComponent(series.id)}`,
        );
        seasonId =
          seasons.items.find((season) => season.seasonNumber === 1)?.id ?? "";
        if (!seasonId) return "season-missing";
        const episodes = await apiJson<{
          items: Array<{ episodeNumber: number; status: string }>;
        }>(
          page,
          `/api/v1/library?limit=100&parentId=${encodeURIComponent(seasonId)}`,
        );
        return episodes.items
          .sort((left, right) => left.episodeNumber - right.episodeNumber)
          .map((episode) => episode.status)
          .join(",");
      },
      { timeout: 15_000 },
    )
    .toBe("available,downloading,missing,missing,missing,missing");

  await page.goto("/library/shows");
  const card = page.locator(".library-card").filter({ hasText: title });
  await card.getByRole("button", { name: `Open ${title} details` }).click();
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /Season 1/ }),
  ).toHaveAttribute("aria-pressed", "true");
  const summary = dialog.getByLabel("Season summary");
  await expect(summary).toContainText("Ready1");
  await expect(summary).toContainText("In progress1");
  await expect(summary).toContainText("Aired & missing2");
  await expect(summary).toContainText("Upcoming / TBA2");
  await expect(dialog.locator(".episode-row--ready")).toContainText("S01E01");
  await expect(dialog.locator(".episode-row--downloading")).toContainText(
    "S01E02",
  );
  await expect(dialog.locator(".episode-row--missing")).toHaveCount(2);
  await expect(dialog.locator(".episode-row--upcoming")).toContainText(
    "S01E05",
  );
  await expect(dialog.locator(".episode-row--tba")).toContainText("S01E06");
  await expect(dialog.getByText("2 aired episodes are missing")).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);

  await dialog
    .getByRole("button", {
      name: "Find a release for S01E03 Episode 3",
    })
    .click();
  await expect(dialog.getByLabel("Season", { exact: true })).toHaveValue("1");
  await expect(dialog.getByLabel("Release target")).toHaveValue("3");
});

test("adds validated magnet and metainfo downloads through the responsive dialog", async ({
  page,
  request,
}, testInfo) => {
  await authenticate(page);
  await page.goto("/activity");
  const suffix = testInfo.project.name;
  const hash = createHash("sha1")
    .update(`manual-magnet-${suffix}`)
    .digest("hex");
  const magnetTitle = `E2E Manual Magnet ${suffix}`;

  await page.getByRole("button", { name: "Add download" }).first().click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Magnet URI")
    .fill(`magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(magnetTitle)}`);
  await dialog.getByRole("button", { name: "Add download" }).click();
  await expect(page.getByRole("heading", { name: magnetTitle })).toBeVisible();
  const magnetDownload = await waitForDownloadState(
    page,
    magnetTitle,
    "downloading",
  );
  await apiJson(page, `/api/v1/downloads/${magnetDownload.id}/files`, {
    method: "PATCH",
    body: { wanted: [0], priorityHigh: [0] },
  });
  await controlFakeServices(request, { restartTransmission: true });
  const magnetCard = page
    .locator(".download-card")
    .filter({ hasText: magnetTitle });
  await magnetCard.getByRole("button", { name: "Pause" }).click();
  await expect(magnetCard).toContainText("paused");
  await magnetCard.getByRole("button", { name: "Resume" }).click();
  await expect(magnetCard).toContainText("downloading");
  await magnetCard.getByRole("button", { name: "Remove" }).click();
  const removeDialog = page.getByRole("dialog");
  await removeDialog.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("heading", { name: magnetTitle })).toBeHidden();

  const torrentName = `e2e-metainfo-${suffix}.torrent`;
  await page.getByRole("button", { name: "Add download" }).first().click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: ".torrent file" }).click();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: torrentName,
    mimeType: "application/x-bittorrent",
    buffer: Buffer.from("d1:x1:ye"),
  });
  await dialog.getByRole("button", { name: "Add download" }).click();
  await expect(page.getByRole("heading", { name: torrentName })).toBeVisible();
});

test("adopts an ambiguous existing movie only after explicit scan review", async ({
  page,
  request,
}, testInfo) => {
  await authenticate(page);
  const title = `E2E Ambiguous Movie ${testInfo.project.name}`;
  const folder = `${mediaRoot}/movies/${title} (2024)`;
  await mkdir(folder, { recursive: true });
  await writeFile(
    `${folder}/${title}.2024.mkv`,
    "existing deterministic media",
  );
  await controlFakeServices(request, { tmdbAmbiguous: true });

  await page.goto("/library/movies");
  await page.getByRole("button", { name: "Scan library" }).click();
  await expect(page.getByRole("status")).toContainText("Library scan queued");
  await expect
    .poll(
      async () => {
        const result = await apiJson<{
          reviews: Array<{ id: string; title: string }>;
        }>(page, "/api/v1/library/scan-reviews?status=pending&kind=movie");
        return result.reviews.some((review) => review.title === title);
      },
      { timeout: 12_000 },
    )
    .toBe(true);

  await controlFakeServices(request, { tmdbAmbiguous: false });
  await page.reload();
  const review = page.locator(".scan-review-card").filter({ hasText: title });
  await expect(review).toContainText("Needs a match");
  await expect(
    review.getByRole("button", { name: "Import this title" }),
  ).toHaveCount(2);
  await review
    .getByRole("button", { name: "Import this title" })
    .first()
    .click();
  await expect(review).toBeHidden();
  const card = page.locator(".library-card").filter({ hasText: title });
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: `Open ${title} details` }).click();
  let dialog = page.getByRole("dialog", { name: title });
  await expect(
    dialog.getByRole("heading", { name: "Ready in your library" }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Automatic monitoring")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Choose replacement" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Retry automatic search" }),
  ).toHaveCount(0);

  await dialog.getByRole("button", { name: "Choose replacement" }).click();
  dialog = page.getByRole("dialog", {
    name: `Choose a replacement for ${title}`,
  });
  await expect(dialog.getByText("explicit replacement")).toBeVisible();
  await expect(dialog.locator(".release-card").first()).toBeVisible();
  await dialog.getByRole("button", { name: "Back to management" }).click();

  dialog = page.getByRole("dialog", { name: title });
  await dialog.getByRole("button", { name: "Remove from library" }).click();
  const removeDialog = page.getByRole("dialog", {
    name: "Remove from library?",
  });
  await expect(
    removeDialog.getByLabel("Remove this title from Bobarr"),
  ).toBeChecked();
  await expect(
    removeDialog.getByLabel("Delete organized library files"),
  ).not.toBeChecked();
  await removeDialog.getByLabel("Delete organized library files").check();
  await removeDialog.getByRole("button", { name: "Confirm removal" }).click();

  await expect(card).toHaveCount(0);
  await expect(access(`${folder}/${title}.2024.mkv`)).rejects.toThrow();
});

test("manages and removes a scan-imported untracked TV show", async ({
  page,
  request,
}, testInfo) => {
  await authenticate(page);
  await controlFakeServices(request, { jackettMode: "empty" });
  const title = `E2E Imported Series ${testInfo.project.name}`;
  const seasonDirectory = `${mediaRoot}/tv/${title} (2024)/Season 01`;
  const episodePath = `${seasonDirectory}/${title}.S01E01.mkv`;
  await mkdir(seasonDirectory, { recursive: true });
  await writeFile(episodePath, "existing deterministic TV episode");

  await page.goto("/library/shows");
  await page.getByRole("button", { name: "Scan library" }).click();
  await expect(page.getByRole("status")).toContainText("Library scan queued");
  await expect
    .poll(
      async () => {
        const library = await apiJson<{
          items: Array<{
            title: string;
            monitorPolicy: string;
            acquisitionState: string;
          }>;
        }>(page, "/api/v1/library?kind=series&limit=100");
        return library.items.find((item) => item.title === title);
      },
      { timeout: 12_000 },
    )
    .toMatchObject({
      monitorPolicy: "none",
      acquisitionState: "available",
    });

  await page.reload();
  let card = page.locator(".library-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: `Open ${title} details` }).click();
  let dialog = page.getByRole("dialog", { name: title });
  await expect(
    dialog.getByText("Monitoring is off", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /Season 1/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: /Season 1/ })).toContainText(
    "Ready · monitoring off",
  );
  const readyEpisode = dialog.locator(".episode-row--ready");
  await expect(readyEpisode).toContainText("S01E01");
  await expect(readyEpisode).toContainText("File is ready in your library");
  await expect(
    dialog.getByText("Monitoring settings", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /Remove from library/ }),
  ).toBeVisible();

  await dialog.getByLabel("Automatic monitoring").selectOption("selected");
  await dialog.getByLabel("Monitor future seasons").check();
  await expect(
    dialog.getByRole("button", { name: "Save monitoring" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Save monitoring" }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => {
      const library = await apiJson<{
        items: Array<{
          title: string;
          monitorPolicy: string;
          metadata: Record<string, unknown>;
        }>;
      }>(page, "/api/v1/library?kind=series&limit=100");
      return library.items.find((item) => item.title === title);
    })
    .toMatchObject({
      monitorPolicy: "selected",
      metadata: { includeFutureSeasons: true },
    });

  card = page.locator(".library-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: `Open ${title} details` }).click();
  dialog = page.getByRole("dialog", { name: title });
  await expect(dialog.getByText("Future seasons only")).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Watching for future seasons" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: /Remove show/ }).click();
  const removeDialog = page.getByRole("dialog", {
    name: "Remove from library?",
  });
  await expect(
    removeDialog.getByLabel("Remove this title from Bobarr"),
  ).toBeChecked();
  await removeDialog.getByLabel("Delete organized library files").check();
  await removeDialog.getByRole("button", { name: "Confirm removal" }).click();

  await expect(card).toHaveCount(0);
  await expect
    .poll(async () => {
      const library = await apiJson<{
        items: Array<{ title: string }>;
      }>(page, "/api/v1/library?kind=series&limit=100");
      return library.items.some((item) => item.title === title);
    })
    .toBe(false);
  await expect(access(episodePath)).rejects.toThrow();
});

test("surfaces a degraded connector result without losing navigation", async ({
  page,
  request,
}) => {
  await authenticate(page);
  await controlFakeServices(request, { transmissionDegraded: true });
  await page.goto("/settings#connections");
  const transmission = page
    .locator(".connection-card")
    .filter({ hasText: "Transmission" });
  await transmission.getByRole("button", { name: "Test" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Transmission connection needs attention",
  );
  await expect(page.getByRole("main")).toBeVisible();
  await controlFakeServices(request, { transmissionDegraded: false });
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
