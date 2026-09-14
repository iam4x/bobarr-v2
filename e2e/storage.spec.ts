import { expect, test } from "@playwright/test";

import { authenticate } from "./helpers";

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
  await expect(page.getByLabel("Downloads path").nth(1)).toHaveValue(
    "/media-2/downloads",
  );
  await expect(page.getByLabel("Movies path").nth(1)).toHaveValue(
    "/media-2/movies",
  );
  await expect(page.getByLabel("Television path").nth(1)).toHaveValue(
    "/media-2/tv",
  );
  await expect(
    page.getByRole("button", { name: "Remove volume" }).nth(1),
  ).toBeEnabled();

  await page.getByRole("button", { name: "Remove volume" }).nth(1).click();
  await expect(page.getByLabel("Downloads path")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Remove volume" }),
  ).toBeDisabled();
});
