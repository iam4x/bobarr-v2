import type { CatalogItem, CatalogRecommendationGroup } from "../types";

import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  suggestionCounts,
  suggestionGroupsForKind,
  suggestionRailState,
  SuggestionKindTabs,
  SuggestionShelf,
} from "./SuggestionsPage";

const movie: CatalogItem = {
  id: "movie-1",
  tmdbId: 1,
  kind: "movie",
  title: "Movie suggestion",
  overview: "",
};

const series: CatalogItem = {
  id: "series-1",
  tmdbId: 2,
  kind: "series",
  title: "TV suggestion",
  overview: "",
};

const movieGroup: CatalogRecommendationGroup = {
  source: {
    id: "library-matrix",
    tmdbId: 603,
    kind: "movie",
    title: "The Matrix",
    year: 1999,
    posterUrl: "/matrix.jpg",
  },
  items: [movie, { ...movie, id: "movie-2", tmdbId: 3 }],
};

const seriesGroup: CatalogRecommendationGroup = {
  source: {
    id: "library-expanse",
    tmdbId: 63639,
    kind: "series",
    title: "The Expanse",
    year: 2015,
    posterUrl: null,
  },
  items: [series],
};

const legacyMovieGroup: CatalogRecommendationGroup = {
  source: {
    id: "legacy-library-mix:movie",
    tmdbId: 1,
    kind: "movie",
    title: "Your movie library",
    year: null,
    posterUrl: null,
  },
  items: [movie],
};

describe("suggestion media tabs", () => {
  test("keeps whole source groups together when filtering by media kind", () => {
    const groups = [movieGroup, seriesGroup];

    expect(suggestionGroupsForKind(groups, "all")).toEqual(groups);
    expect(
      suggestionGroupsForKind(groups, "movie").map(
        (group) => group.source.title,
      ),
    ).toEqual(["The Matrix"]);
    expect(
      suggestionGroupsForKind(groups, "series").map(
        (group) => group.source.title,
      ),
    ).toEqual(["The Expanse"]);
    expect(suggestionGroupsForKind(undefined, "all")).toEqual([]);
    expect(suggestionCounts(groups)).toEqual({
      all: 3,
      movie: 2,
      series: 1,
    });
  });

  test("renders an accessible tab list with one active tab", () => {
    const markup = renderToStaticMarkup(
      <SuggestionKindTabs
        value="all"
        counts={{ all: 20, movie: 12, series: 8 }}
        onChange={() => {}}
      />,
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Suggestion type"');
    expect(markup).toContain('id="suggestions-tab-all"');
    expect(markup).toContain('id="suggestions-tab-movie"');
    expect(markup).toContain('aria-controls="suggestions-panel-series"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('aria-selected="false"');
    expect(markup).toContain("All");
    expect(markup).toContain("Movies");
    expect(markup).toContain("TV Shows");
    expect(markup).toContain(">20<");
    expect(markup).toContain(">12<");
    expect(markup).toContain(">8<");
    expect(markup).toContain("20 suggestions");
  });
});

describe("suggestion rail controls", () => {
  test("only enables directions that have overflow remaining", () => {
    expect(
      suggestionRailState({
        clientWidth: 600,
        scrollWidth: 500,
        scrollLeft: 0,
      }),
    ).toEqual({
      overflow: false,
      canScrollLeft: false,
      canScrollRight: false,
    });
    expect(
      suggestionRailState({
        clientWidth: 500,
        scrollWidth: 1_200,
        scrollLeft: 0,
      }),
    ).toEqual({
      overflow: true,
      canScrollLeft: false,
      canScrollRight: true,
    });
    expect(
      suggestionRailState({
        clientWidth: 500,
        scrollWidth: 1_200,
        scrollLeft: 350,
      }),
    ).toEqual({
      overflow: true,
      canScrollLeft: true,
      canScrollRight: true,
    });
    expect(
      suggestionRailState({
        clientWidth: 500,
        scrollWidth: 1_200,
        scrollLeft: 700,
      }),
    ).toEqual({
      overflow: true,
      canScrollLeft: true,
      canScrollRight: false,
    });
  });
});

describe("suggestion shelf", () => {
  test("explains its library source and exposes labelled scroll controls", () => {
    const markup = renderToStaticMarkup(
      <SuggestionShelf group={movieGroup} onSelect={() => {}} />,
    );

    expect(markup).toContain("<section");
    expect(markup).toContain('aria-labelledby="suggestion-source-movie-603"');
    expect(markup).toContain('id="suggestion-source-movie-603-rail"');
    expect(markup).toContain("Because “The Matrix” is in your library");
    expect(markup).toContain("1999 · Movie · 2 suggestions");
    expect(markup).toContain("https://image.tmdb.org/t/p/w342/matrix.jpg");
    expect(markup).toContain('aria-label="Scroll The Matrix suggestions left"');
    expect(markup).toContain(
      'aria-label="Scroll The Matrix suggestions right"',
    );
    expect(markup).toContain('role="group"');
    expect(markup).toContain('role="region"');
    expect(markup).toContain("hidden");
    expect(markup).toContain("disabled");
    expect(markup).toContain('aria-label="View Movie suggestion"');
  });

  test("does not add redundant scroll buttons for a single recommendation", () => {
    const markup = renderToStaticMarkup(
      <SuggestionShelf group={seriesGroup} onSelect={() => {}} />,
    );

    expect(markup).toContain("Because “The Expanse” is in your library");
    expect(markup).not.toContain("suggestions left");
    expect(markup).not.toContain("suggestions right");
  });

  test("labels a legacy flat response honestly during rolling upgrades", () => {
    const markup = renderToStaticMarkup(
      <SuggestionShelf group={legacyMovieGroup} onSelect={() => {}} />,
    );

    expect(markup).toContain("More movies based on your library");
    expect(markup).not.toContain("Because “Your movie library”");
  });
});
