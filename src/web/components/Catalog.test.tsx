import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ExternalRatings, seasonYearLabel } from "./Catalog";

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

describe("season year labels", () => {
  test("shows the full airing range from dated episodes", () => {
    expect(
      seasonYearLabel({
        tmdbId: 8,
        name: "Season 8",
        overview: "",
        airDate: "2014-09-22",
        seasonNumber: 8,
        posterPath: null,
        episodes: [
          {
            tmdbId: 1,
            name: "Premiere",
            overview: "",
            airDate: "2014-09-22",
            episodeNumber: 1,
            seasonNumber: 8,
            runtimeMinutes: 22,
            stillPath: null,
            voteAverage: 8,
          },
          {
            tmdbId: 24,
            name: "Finale",
            overview: "",
            airDate: "2015-05-07",
            episodeNumber: 24,
            seasonNumber: 8,
            runtimeMinutes: 22,
            stillPath: null,
            voteAverage: 8,
          },
        ],
      }),
    ).toBe("2014–2015");
  });

  test("uses a single year and handles seasons without dates", () => {
    const season = {
      tmdbId: 9,
      name: "Season 9",
      overview: "",
      airDate: "2015-09-21",
      seasonNumber: 9,
      posterPath: null,
      episodes: [],
    };
    expect(seasonYearLabel(season)).toBe("2015");
    expect(seasonYearLabel({ ...season, airDate: null })).toBe("Year TBA");
  });
});
