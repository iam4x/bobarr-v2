import { expect, test } from "@playwright/test";

import { authenticate } from "./helpers";

test("renders an actionable first-run screen", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Internal Server Error");
});

test("opens every management view after setup or login", async ({ page }) => {
  await authenticate(page);
  const routes = [
    ["/search", "Find your next favorite"],
    ["/discover", "Discover something remarkable"],
    ["/suggestions", "A few thoughtful suggestions"],
    ["/library/movies", "Movies"],
    ["/library/shows", "Shows"],
    ["/calendar", "Coming to your screen"],
    ["/activity", "Activity"],
    ["/settings", "Settings"],
  ] as const;

  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(
      "Internal Server Error",
    );
  }
});

test("keeps navigation usable at every supported viewport", async ({
  page,
}, testInfo) => {
  await authenticate(page);
  const viewport = testInfo.project.name;
  const navigation =
    viewport === "phone"
      ? page.locator("[data-mobile-navigation]")
      : page.locator("[data-desktop-navigation]");
  await expect(navigation).toBeVisible();
});
