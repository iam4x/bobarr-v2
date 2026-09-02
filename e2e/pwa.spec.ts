import { expect, test } from "@playwright/test";

import { authenticate, dragTouch } from "./helpers";

test("uses one-tap controls and handle-only sheet gestures on a phone", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone");
  await authenticate(page);

  const viewport = page.locator('meta[name="viewport"]');
  await expect(viewport).toHaveAttribute("content", /maximum-scale=1/);
  await expect(viewport).toHaveAttribute("content", /user-scalable=no/);

  const more = page.getByRole("button", { name: "More" });
  await more.tap();
  const sheet = page.getByRole("dialog", { name: "More from Bobarr" });
  await expect(sheet).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");

  const handle = sheet.locator("[data-sheet-drag-handle]");
  await expect(handle).toBeVisible();
  await expect(handle).toHaveCSS("touch-action", "none");
  expect((await handle.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expect(sheet.getByRole("button", { name: "Close menu" })).toHaveCSS(
    "touch-action",
    "manipulation",
  );

  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await dragTouch(page, {
    from,
    to: { x: from.x, y: Math.min(from.y + 220, 760) },
  });
  expect(await sheet.getAttribute("data-sheet-settling")).toBe("dismissed");
  await expect(sheet).toBeHidden();
  await expect(more).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");

  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(sheet).toBeVisible();
  const reopenedBox = await handle.boundingBox();
  expect(reopenedBox).not.toBeNull();
  if (!reopenedBox) return;
  const reopenedFrom = {
    x: reopenedBox.x + reopenedBox.width / 2,
    y: reopenedBox.y + reopenedBox.height / 2,
  };
  await dragTouch(page, {
    from: reopenedFrom,
    to: { x: reopenedFrom.x + 45, y: reopenedFrom.y + 6 },
  });
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveAttribute("data-sheet-settling");
  await page.touchscreen.tap(12, 90);
  await expect(sheet).toBeHidden();

  await more.tap();
  await sheet.getByRole("button", { name: "Close menu" }).tap();
  await expect(sheet).toBeHidden();

  await page.goto("/search");
  const search = page.getByRole("searchbox", {
    name: "Search movies and shows",
  });
  await expect(search).toHaveCSS("font-size", "16px");
  await expect(search).toHaveCSS("touch-action", "manipulation");
  await search.tap();
  await expect(search).toBeFocused();
});
