import { describe, expect, test } from "bun:test";

import { normalizedSearchTerm, SEARCH_DEBOUNCE_MS } from "./SearchPage";

describe("search-as-you-type", () => {
  test("waits for a meaningful normalized TMDB term", () => {
    expect(normalizedSearchTerm(" ")).toBe("");
    expect(normalizedSearchTerm(" a ")).toBe("");
    expect(normalizedSearchTerm("  Alien  ")).toBe("Alien");
    expect(SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(250);
  });
});
