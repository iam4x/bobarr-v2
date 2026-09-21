import { describe, expect, test } from "bun:test";

import {
  actorDiscoverPath,
  directorDiscoverPath,
  ExternalRatings,
  MovieCast,
  MovieDirectors,
  seasonYearLabel,
} from "./Catalog";
import { en } from "../i18n/en";
import { renderWithUi } from "../i18n/test-utils";

describe("catalog external ratings", () => {
  test("renders compact ratings with full accessible labels", () => {
    const markup = renderWithUi(
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
      renderWithUi(
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
    const markup = renderWithUi(
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

  test("reserves six skeleton actor cards while cast is loading", () => {
    const markup = renderWithUi(
      <MovieCast loading actors={undefined} onSelect={() => undefined} />,
    );

    expect(markup).toContain('aria-label="Top cast"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup.match(/actor-card--skeleton/g)?.length).toBe(6);
    expect(markup).not.toContain("Discover movies with");
  });
});

describe("movie directors", () => {
  test("renders at most three accessible director chips with profile fallbacks", () => {
    const directors = Array.from({ length: 4 }, (_, index) => ({
      tmdbId: index + 1,
      name: `Director ${index + 1}`,
      job: "Director" as const,
      profilePath: index === 1 ? "/director-2.jpg" : null,
    }));
    const markup = renderWithUi(
      <MovieDirectors directors={directors} onSelect={() => undefined} />,
    );

    expect(markup).toContain('aria-label="Directed by"');
    expect(markup).toContain(
      'aria-label="Discover movies directed by Director 1"',
    );
    expect(markup).toContain("Director");
    expect(markup).toContain("/w342/director-2.jpg");
    expect(markup).toContain("Director 3");
    expect(markup).not.toContain("Director 4");
  });

  test("builds a deep-linkable director Discover URL", () => {
    expect(
      directorDiscoverPath({ tmdbId: 525, name: "Christopher Nolan" }),
    ).toBe("/discover?directorId=525&directorName=Christopher+Nolan");
  });

  test("reserves two skeleton director chips while credits are loading", () => {
    const markup = renderWithUi(
      <MovieDirectors
        loading
        directors={undefined}
        onSelect={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Directed by"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup.match(/director-chip--skeleton/g)?.length).toBe(2);
    expect(markup).not.toContain("Discover movies directed by");
  });

  test("omits the region when no directors are present", () => {
    expect(
      renderWithUi(
        <MovieDirectors directors={[]} onSelect={() => undefined} />,
      ),
    ).toBe("");
    expect(
      renderWithUi(
        <MovieDirectors directors={undefined} onSelect={() => undefined} />,
      ),
    ).toBe("");
  });
});

describe("season year labels", () => {
  test("shows the full airing range from dated episodes", () => {
    expect(
      seasonYearLabel(
        {
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
        },
        en,
      ),
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
    expect(seasonYearLabel(season, en)).toBe("2015");
    expect(seasonYearLabel({ ...season, airDate: null }, en)).toBe("Year TBA");
  });
});
