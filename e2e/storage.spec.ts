import type { AppSettings, Job } from "../src/contracts";

import { mkdir } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { apiJson, authenticate } from "./helpers";

test("adds a second storage volume from Settings", async ({ page }) => {
  await authenticate(page);
  await page.goto("/settings#storage");
  await expect(
    page.getByRole("heading", { name: "Storage & organization" }),
  ).toBeVisible();
  await expect(page.getByLabel("Downloads path")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Remove volume" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "Add volume" }).click();
  await expect(page.getByLabel("Downloads path")).toHaveCount(2);
  await expect(page.getByLabel("Label").nth(1)).toHaveValue("Volume 1");
  await expect(page.getByLabel("Downloads path").nth(1)).toHaveValue("");
  await expect(page.getByLabel("Movies path").nth(1)).toHaveValue("");
  await expect(page.getByLabel("Television path").nth(1)).toHaveValue("");
  await expect(
    page.getByText("Type the container path for a disk already listed"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove volume" }).nth(1),
  ).toBeEnabled();

  await page.getByRole("button", { name: "Remove volume" }).nth(1).click();
  await expect(page.getByLabel("Downloads path")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Remove volume" }),
  ).toBeDisabled();
});

test("organizes saved volumes in the background and opens its job", async ({
  page,
}, testInfo) => {
  await authenticate(page);
  const original = await apiJson<AppSettings>(page, "/api/v1/settings");
  const secondRoot = "/tmp/bobarr-e2e/second-volume";
  await Promise.all(
    ["downloads", "movies", "tv"].map((name) =>
      mkdir(`${secondRoot}/${name}`, { recursive: true }),
    ),
  );
  await page.goto("/settings#storage");
  const organize = page.getByRole("button", {
    name: "Organize volumes",
    exact: true,
  });
  await expect(organize).toBeDisabled();
  await page.getByRole("button", { name: "Add volume" }).click();
  await page
    .getByLabel("Downloads path")
    .nth(1)
    .fill(`${secondRoot}/downloads`);
  await page.getByLabel("Movies path").nth(1).fill(`${secondRoot}/movies`);
  await page.getByLabel("Television path").nth(1).fill(`${secondRoot}/tv`);
  await expect(organize).toBeDisabled();
  await expect(
    page.getByText("Save your settings before organizing volumes."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(organize).toBeEnabled();
  try {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/settings/storage/organize") &&
        response.request().method() === "POST",
    );
    await organize.click();
    const response = await responsePromise;
    expect(response.status()).toBe(202);
    const job = (await response.json()) as Job;
    expect(job.status).toBe("queued");
    await page.reload();
    await expect(
      page.getByRole("link", { name: "View job in Activity" }),
    ).toBeVisible();
    await expect
      .poll(
        async () => (await apiJson<Job>(page, `/api/v1/jobs/${job.id}`)).status,
      )
      .toBe("completed");
    await expect(
      page.getByText("Volume organization completed."),
    ).toBeVisible();
    await page
      .locator(".storage-organization")
      .screenshot({ path: testInfo.outputPath("organize-volumes.png") });
    await page.getByRole("link", { name: "View job in Activity" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("heading", { name: "Organize volumes" }),
    ).toBeVisible();
  } finally {
    await apiJson(page, "/api/v1/settings", {
      method: "PATCH",
      body: { storage: original.storage },
    });
  }
});
