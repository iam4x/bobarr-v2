import { expect, test } from "@playwright/test";

import { authenticate, e2eTitle } from "./helpers";

test("an invited user can join and cannot open Settings", async ({
  page,
  browser,
}, testInfo) => {
  const friendName = e2eTitle(testInfo, "e2e-friend");
  await authenticate(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

  const inviteResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/users/invites") &&
      response.request().method() === "POST" &&
      response.ok(),
  );
  await page.getByRole("button", { name: "Invite someone" }).click();
  const created = (await (await inviteResponse).json()) as { token: string };
  expect(created.token.length).toBeGreaterThan(20);

  const friendContext = await browser.newContext();
  const friendPage = await friendContext.newPage();
  await friendPage.goto(`/invite?token=${encodeURIComponent(created.token)}`);
  await expect(
    friendPage.getByRole("heading", { name: "Create your Bobarr account" }),
  ).toBeVisible();
  await friendPage.getByLabel("Username").fill(friendName);
  await friendPage.locator('input[name="password"]').fill("friend-pass-2026");
  await friendPage
    .locator('input[name="confirmation"]')
    .fill("friend-pass-2026");
  await friendPage.getByRole("button", { name: "Join Bobarr" }).click();
  await expect(friendPage).toHaveURL(/\/discover/);

  await expect(
    friendPage.locator("[data-desktop-navigation]").getByText("Settings"),
  ).toHaveCount(0);
  await friendPage.goto("/settings");
  await expect(friendPage).toHaveURL(/\/discover/);

  await friendPage.goto("/account");
  await expect(
    friendPage.getByRole("heading", { name: "Your sign-in" }),
  ).toBeVisible();
  if (await friendPage.locator("[data-desktop-navigation]").isVisible()) {
    await expect(
      friendPage.getByRole("button", { name: "Sign out" }),
    ).toBeVisible();
  } else {
    await friendPage.getByRole("button", { name: "More" }).click();
    await expect(
      friendPage.getByRole("button", { name: "Sign out" }),
    ).toBeVisible();
  }

  await page.reload();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await page
    .locator("li")
    .filter({ hasText: friendName })
    .getByRole("button", { name: "Make admin" })
    .click();
  await expect(
    page.getByText(`${friendName} is now an administrator.`),
  ).toBeVisible();

  await friendPage.reload();
  await friendPage.goto("/settings");
  await expect(friendPage).toHaveURL(/\/settings/);
  await expect(
    friendPage.getByRole("heading", { name: "People" }),
  ).toBeVisible();

  await friendContext.close();
});
