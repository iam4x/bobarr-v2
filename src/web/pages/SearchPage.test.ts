import type { CatalogItem } from "../types";

import { describe, expect, test } from "bun:test";

import {
  currentSearchData,
  mergeSearchPages,
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

  test("joins loaded pages and drops titles repeated across pages", () => {
    const title = (tmdbId: number, kind: "movie" | "series" = "movie") =>
      ({
        id: `${kind}:${tmdbId}`,
        tmdbId,
        kind,
        title: `T${tmdbId}`,
      }) as CatalogItem;
    const merged = mergeSearchPages([
      { items: [title(1), title(2)], page: 1, totalPages: 3, totalItems: 55 },
      {
        items: [title(2), title(2, "series"), title(3)],
        page: 2,
        totalPages: 3,
        totalItems: 55,
      },
    ]);

    expect(merged.items.map((item) => item.id)).toEqual([
      "movie:1",
      "movie:2",
      "series:2",
      "movie:3",
    ]);
    expect(merged).toMatchObject({ page: 2, totalPages: 3, totalItems: 55 });
  });
});
