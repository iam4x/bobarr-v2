import { describe, expect, test } from "bun:test";

import {
  createDefaultLibraryBrowseFilters,
  libraryAvailabilityParam,
  libraryBrowseFromSearchParams,
  libraryBrowseIsDefault,
  libraryNeedsAttentionCount,
  LIBRARY_SORT_OPTIONS,
  libraryYearOptions,
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
    };
    const params = writeLibraryBrowseSearchParams(
      new URLSearchParams("view=poster"),
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

  test("offers every sort the URL accepts", () => {
    expect(LIBRARY_SORT_OPTIONS).toContain("added_at.asc");
  });

  test("offers years from next year back to 1900", () => {
    const years = libraryYearOptions("", new Date("2026-09-26T12:00:00Z"));
    expect(years[0]).toBe(2027);
    expect(years.at(-1)).toBe(1900);
    expect(years).toContain(1994);
  });

  test("keeps an applied year that is outside the usual range", () => {
    const years = libraryYearOptions("1895", new Date("2026-09-26T12:00:00Z"));
    expect(years.at(-1)).toBe(1895);
    expect(
      libraryYearOptions("", new Date("2026-09-26T12:00:00Z")),
    ).not.toContain(1895);
  });
});
