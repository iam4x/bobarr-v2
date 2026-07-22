import { describe, expect, test } from "bun:test";

import {
  currentSearchData,
  normalizedSearchTerm,
  SEARCH_DEBOUNCE_MS,
} from "./SearchPage";

describe("search-as-you-type", () => {
  test("waits for a meaningful normalized TMDB term", () => {
    expect(normalizedSearchTerm(" ")).toBe("");
    expect(normalizedSearchTerm(" a ")).toBe("");
    expect(normalizedSearchTerm("  Alien  ")).toBe("Alien");
    expect(SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(250);
  });

  test("hides cached results when the query is cleared", () => {
    const cached = { items: [{ id: "cached-result" }] };

    expect(currentSearchData("Alien", cached)).toBe(cached);
    expect(currentSearchData("", cached)).toBeUndefined();
    expect(currentSearchData(" ", cached)).toBeUndefined();
  });
});
