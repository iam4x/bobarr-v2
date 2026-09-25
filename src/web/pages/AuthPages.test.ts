import { describe, expect, test } from "bun:test";

import { postLoginPath } from "./AuthPages";

describe("post-login redirect", () => {
  test("returns to the page that required a session", () => {
    expect(
      postLoginPath({
        from: {
          pathname: "/activity",
          search: "?tab=jobs&job=42",
          hash: "",
        },
      }),
    ).toBe("/activity?tab=jobs&job=42");
    expect(
      postLoginPath({
        from: { pathname: "/settings", search: "", hash: "#people" },
      }),
    ).toBe("/settings#people");
  });

  test("falls back to Discover for missing, auth or off-site targets", () => {
    expect(postLoginPath(undefined)).toBe("/discover");
    expect(postLoginPath({ from: "/library" })).toBe("/discover");
    expect(postLoginPath({ from: { pathname: "/login" } })).toBe("/discover");
    expect(postLoginPath({ from: { pathname: "//evil.example" } })).toBe(
      "/discover",
    );
  });
});
