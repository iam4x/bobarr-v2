import { describe, expect, test } from "bun:test";

import {
  appliedDiscoverFilters,
  createDefaultDiscoverFilters,
  discoverActorFromSearchParams,
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
    expect(
      discoverQueryFor("movie", createDefaultDiscoverFilters(), 1).hideOwned,
    ).toBe(true);
    expect(
      appliedDiscoverFilters(
        { ...createDefaultDiscoverFilters(), hideOwned: false },
        labels,
      ),
    ).toContainEqual({ key: "hideOwned", label: "Showing owned titles" });
  });

  test("builds and removes a deep-linked actor filter", () => {
    const actor = discoverActorFromSearchParams(
      new URLSearchParams("actorId=6384&actorName=Keanu+Reeves"),
    );
    expect(actor).toEqual({ tmdbId: 6384, name: "Keanu Reeves" });

    const filters = {
      ...createDefaultDiscoverFilters(),
      actorId: actor!.tmdbId,
      actorName: actor!.name,
      genreIds: [878],
    };
    expect(discoverQueryFor("movie", filters, 3)).toMatchObject({
      kind: "movie",
      page: 3,
      actorId: 6384,
      genres: "878",
    });
    expect(appliedDiscoverFilters(filters, labels)[0]).toEqual({
      key: "actor",
      label: "Actor: Keanu Reeves",
    });
    expect(removeDiscoverFilter(filters, "actor")).toMatchObject({
      actorId: null,
      actorName: "",
      genreIds: [878],
    });
    expect(
      discoverActorFromSearchParams(new URLSearchParams("actorId=invalid")),
    ).toBeUndefined();
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
