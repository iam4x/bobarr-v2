import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ScanReviewCard } from "./ScanReviewPanel";

describe("scan review surface", () => {
  test("renders explicit, touch-friendly TMDB choices and a dismiss action", () => {
    const markup = renderToStaticMarkup(
      <ScanReviewCard
        review={{
          id: "89b3e601-c3b1-4a65-93b0-5c5eefda38ab",
          kind: "movie",
          title: "Matrix",
          year: 1999,
          rootPath: "/media/movies",
          files: [{ path: "/media/movies/Matrix/movie.mkv", sizeBytes: 42 }],
          candidates: [
            {
              tmdbId: 603,
              kind: "movie",
              title: "The Matrix",
              year: 1999,
              posterPath: "/poster.jpg",
              overview: "A hacker discovers the nature of reality.",
            },
          ],
          status: "pending",
          resolvedTmdbId: null,
          mediaItemId: null,
          createdAt: "2026-07-21T12:00:00.000Z",
          updatedAt: "2026-07-21T12:00:00.000Z",
          resolvedAt: null,
        }}
        onResolve={() => undefined}
        onDismiss={() => undefined}
      />,
    );

    expect(markup).toContain("Needs a match");
    expect(markup).toContain("The Matrix");
    expect(markup).toContain("Import this title");
    expect(markup).toContain("Dismiss");
    expect(markup).not.toContain("movie.mkv");
  });
});
