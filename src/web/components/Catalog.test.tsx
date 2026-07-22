import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ExternalRatings } from "./Catalog";

describe("catalog external ratings", () => {
  test("renders compact ratings with full accessible labels", () => {
    const markup = renderToStaticMarkup(
      <ExternalRatings
        ratings={{
          imdb: { value: 8.7, scale: 10, votes: 2_107_348 },
          rottenTomatoes: { value: 83, scale: 100 },
        }}
      />,
    );

    expect(markup).toContain('aria-label="External ratings"');
    expect(markup).toContain('aria-label="IMDb rating 8.7 out of 10"');
    expect(markup).toContain('aria-label="Rotten Tomatoes rating 83 percent"');
    expect(markup).toContain("8.7");
    expect(markup).toContain("83%");
  });

  test("omits the region when both sources are unavailable", () => {
    expect(
      renderToStaticMarkup(
        <ExternalRatings ratings={{ imdb: null, rottenTomatoes: null }} />,
      ),
    ).toBe("");
  });
});
