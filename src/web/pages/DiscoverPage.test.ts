import { describe, expect, test } from "bun:test";

import {
  appliedDiscoverFilters,
  createDefaultDiscoverFilters,
  discoverFilterError,
  discoverQueryFor,
  removeDiscoverFilter,
  sortForKind,
} from "./DiscoverPage";

const labels = {
  genres: new Map([[878, "Science Fiction"]]),
  countries: new Map([["FR", "France"]]),
  languages: new Map([["fr", "French"]]),
};

describe("Discover filters", () => {
  test("shows the backend-owned vote floor for highest-rated discovery", () => {
    const filters = {
      ...createDefaultDiscoverFilters(),
      sort: "vote_average.desc" as const,
    };

    expect(discoverQueryFor("movie", filters, 1)).toMatchObject({
      kind: "movie",
      sort: "vote_average.desc",
    });
    expect(discoverQueryFor("movie", filters, 1).voteCountMin).toBeUndefined();
    expect(appliedDiscoverFilters(filters, labels)).toEqual([
      { key: "sort", label: "Highest rated" },
      { key: "voteCountMin", label: "200+ votes" },
    ]);
  });

  test("removing the top-rated vote chip explicitly disables its default", () => {
    const highestRated = {
      ...createDefaultDiscoverFilters(),
      sort: "vote_average.desc" as const,
    };
    const withoutFloor = removeDiscoverFilter(highestRated, "voteCountMin");

    expect(withoutFloor.voteCountMin).toBe("0");
    expect(discoverQueryFor("series", withoutFloor, 1).voteCountMin).toBe(0);
    expect(
      appliedDiscoverFilters(withoutFloor, labels).map((filter) => filter.key),
    ).toEqual(["sort"]);
  });

  test("builds removable chips for useful TMDB filters", () => {
    const filters = {
      ...createDefaultDiscoverFilters(),
      genreIds: [878],
      originCountry: "FR",
      originalLanguage: "fr",
      runtimeMin: "90",
      runtimeMax: "180",
      ratingMin: "7.5",
    };

    expect(appliedDiscoverFilters(filters, labels)).toEqual([
      { key: "genre:878", label: "Science Fiction" },
      { key: "originCountry", label: "France" },
      { key: "originalLanguage", label: "Language: French" },
      { key: "runtime", label: "Length: 90 min – 180 min" },
      { key: "ratingMin", label: "Rated 7.5+" },
    ]);
    expect(removeDiscoverFilter(filters, "genre:878").genreIds).toEqual([]);
    expect(
      discoverQueryFor("movie", { ...filters, genreIds: [878, 18, 878] }, 1)
        .genres,
    ).toBe("18,878");
  });

  test("normalizes kind-specific sorting and rejects reversed ranges", () => {
    expect(sortForKind("series", "primary_release_date.desc")).toBe(
      "first_air_date.desc",
    );
    expect(sortForKind("series", "revenue.desc")).toBe("popularity.desc");
    expect(sortForKind("movie", "name.asc")).toBe("title.asc");

    expect(
      discoverFilterError({
        ...createDefaultDiscoverFilters(),
        runtimeMin: "180",
        runtimeMax: "90",
      }),
    ).toContain("Maximum length");
    expect(
      discoverFilterError({
        ...createDefaultDiscoverFilters(),
        dateFrom: "2026-01-01",
        dateTo: "2025-01-01",
      }),
    ).toContain("end date");
    expect(
      discoverFilterError({
        ...createDefaultDiscoverFilters(),
        dateFrom: "1800-01-01",
      }),
    ).toContain("Start date");
    expect(
      appliedDiscoverFilters(
        { ...createDefaultDiscoverFilters(), dateFrom: "2024-01-01" },
        labels,
      ),
    ).toEqual([{ key: "dateRange", label: "From 2024-01-01" }]);
  });
});
