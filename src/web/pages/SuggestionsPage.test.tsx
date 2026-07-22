import type { CatalogItem } from "../types";

import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  suggestionCounts,
  SuggestionKindTabs,
  suggestionsForKind,
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

describe("suggestion media tabs", () => {
  test("keeps movie and TV recommendations in separate result sets", () => {
    const items = [movie, series, { ...movie, id: "movie-2", tmdbId: 3 }];

    expect(suggestionsForKind(items, "movie").map((item) => item.id)).toEqual([
      "movie-1",
      "movie-2",
    ]);
    expect(suggestionsForKind(items, "series").map((item) => item.id)).toEqual([
      "series-1",
    ]);
    expect(suggestionCounts(items)).toEqual({ movie: 2, series: 1 });
  });

  test("renders an accessible tab list with one active tab", () => {
    const markup = renderToStaticMarkup(
      <SuggestionKindTabs
        value="movie"
        counts={{ movie: 12, series: 8 }}
        onChange={() => {}}
      />,
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Suggestion type"');
    expect(markup).toContain('id="suggestions-tab-movie"');
    expect(markup).toContain('aria-controls="suggestions-panel-series"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('aria-selected="false"');
    expect(markup).toContain("Movies");
    expect(markup).toContain("TV Shows");
    expect(markup).toContain(">12<");
    expect(markup).toContain(">8<");
  });
});
