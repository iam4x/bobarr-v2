import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  actorDiscoverPath,
  ExternalRatings,
  MovieCast,
  seasonYearLabel,
} from "./Catalog";

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

describe("movie cast", () => {
  test("renders at most six accessible actor cards with profile fallbacks", () => {
    const actors = Array.from({ length: 7 }, (_, index) => ({
      tmdbId: index + 1,
      name: `Actor ${index + 1}`,
      character: index === 0 ? "The Lead" : null,
      profilePath: index === 1 ? "/actor-2.jpg" : null,
    }));
    const markup = renderToStaticMarkup(
      <MovieCast actors={actors} onSelect={() => undefined} />,
    );

    expect(markup).toContain('aria-label="Top cast"');
    expect(markup).toContain('aria-label="Discover movies with Actor 1"');
    expect(markup).toContain("The Lead");
    expect(markup).toContain("/w342/actor-2.jpg");
    expect(markup).toContain("Actor 6");
    expect(markup).not.toContain("Actor 7");
  });

  test("builds a deep-linkable actor Discover URL", () => {
    expect(actorDiscoverPath({ tmdbId: 6384, name: "Keanu Reeves" })).toBe(
      "/discover?actorId=6384&actorName=Keanu+Reeves",
    );
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
