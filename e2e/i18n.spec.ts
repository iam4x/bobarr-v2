import { expect, test } from "@playwright/test";

import { authenticate } from "./helpers";

test("keeps French UI after reload and stores it on the profile", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Your sign-in", exact: true }),
  ).toBeVisible();

  await page.getByLabel("Language", { exact: true }).selectOption("fr");
  await expect(
    page.getByRole("heading", { name: "Votre connexion", exact: true }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Votre connexion", exact: true }),
  ).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  expect(me.ok()).toBe(true);
  expect(await me.json()).toMatchObject({ user: { uiLocale: "fr" } });
});
