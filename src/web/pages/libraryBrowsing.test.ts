import { describe, expect, test } from "bun:test";

import {
  createDefaultLibraryBrowseFilters,
  libraryAvailabilityParam,
  libraryBrowseFromSearchParams,
  libraryBrowseIsDefault,
  libraryNeedsAttentionCount,
  writeLibraryBrowseSearchParams,
} from "./libraryBrowsing";

describe("library browsing helpers", () => {
  test("maps availability chips to server filters", () => {
    expect(libraryAvailabilityParam("all")).toBeUndefined();
    expect(libraryAvailabilityParam("missing")).toBe("missing");
    expect(libraryAvailabilityParam("active")).toBe("active");
  });

  test("round-trips browse state through the URL", () => {
    const filters = {
      ...createDefaultLibraryBrowseFilters(),
      filter: "failed" as const,
      sort: "title.asc" as const,
      genreId: 28,
      year: "1999",
      ratingMin: "8",
      quality: "1080p",
      viewMode: "detailed" as const,
    };
    const params = writeLibraryBrowseSearchParams(
      new URLSearchParams(),
      filters,
      "matrix",
      "item-1",
    );
    expect(Object.fromEntries(params.entries())).toEqual({
      availability: "failed",
      sort: "title.asc",
      genreId: "28",
      year: "1999",
      ratingMin: "8",
      quality: "1080p",
      view: "detailed",
      q: "matrix",
      item: "item-1",
    });
    expect(libraryBrowseFromSearchParams(params)).toMatchObject({
      filter: "failed",
      sort: "title.asc",
      genreId: 28,
      year: "1999",
      ratingMin: "8",
      quality: "1080p",
      viewMode: "detailed",
      search: "matrix",
      itemId: "item-1",
    });
    expect(libraryBrowseIsDefault(filters, "matrix")).toBe(false);
    expect(
      libraryBrowseIsDefault(createDefaultLibraryBrowseFilters(), ""),
    ).toBe(true);
  });

  test("counts titles that need attention", () => {
    expect(libraryNeedsAttentionCount({ missing: 2, failed: 3 })).toBe(5);
  });
});
