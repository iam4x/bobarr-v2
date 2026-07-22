import type { LibraryItem } from "../types";

import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  canManuallySearchLibraryItem,
  LibraryCard,
  LibrarySummary,
  libraryReleaseTarget,
} from "./LibraryPage";

const movie: LibraryItem = {
  id: "movie-1",
  tmdbId: 603,
  kind: "movie",
  title: "The Matrix",
  overview: "",
  monitorPolicy: "all",
  acquisitionState: "missing",
};

describe("library manual release targets", () => {
  test("opens library details from the full card without an overflow menu", () => {
    const markup = renderToStaticMarkup(
      LibraryCard({ item: movie, onManage: () => undefined }),
    );

    expect(markup).toContain('class="library-card__hit-area"');
    expect(markup).toContain('aria-label="Open The Matrix details"');
    expect(markup).not.toContain("Manage The Matrix");
    expect(markup).not.toContain("lucide-ellipsis");
  });

  test("shows downloaded and total library counts", () => {
    const markup = renderToStaticMarkup(
      LibrarySummary({
        summary: {
          total: 367,
          downloaded: 9,
          active: 0,
          missing: 358,
          failed: 0,
        },
      }),
    );

    expect(markup).toContain("Downloaded</dt><dd>9");
    expect(markup).toContain("Total</dt><dd>367");
  });

  test("keeps manual replacement available throughout monitored acquisition", () => {
    for (const acquisitionState of [
      "searching",
      "queued",
      "downloading",
      "organizing",
      "available",
    ] as const) {
      expect(canManuallySearchLibraryItem({ ...movie, acquisitionState })).toBe(
        true,
      );
    }

    expect(
      canManuallySearchLibraryItem({
        ...movie,
        monitorPolicy: "none",
        acquisitionState: "unmonitored",
      }),
    ).toBe(false);
    expect(canManuallySearchLibraryItem({ ...movie, tmdbId: null })).toBe(
      false,
    );
  });

  test("maps a movie to a movie search", () => {
    expect(libraryReleaseTarget(movie)).toEqual({
      tmdbId: 603,
      kind: "movie",
    });
  });

  test("maps a show to season-pack and episode searches", () => {
    const series: LibraryItem = {
      ...movie,
      id: "series-1",
      tmdbId: 1399,
      kind: "series",
      title: "Game of Thrones",
    };

    expect(libraryReleaseTarget(series, 4)).toEqual({
      tmdbId: 1399,
      kind: "series",
      season: 4,
    });
    expect(libraryReleaseTarget(series, 4, 2)).toEqual({
      tmdbId: 1399,
      kind: "series",
      season: 4,
      episode: 2,
    });
  });

  test("rejects incomplete or invalid provider identities", () => {
    const series = { ...movie, kind: "series" as const };
    const unmatched = {
      ...movie,
      tmdbId: null,
    };

    expect(libraryReleaseTarget(series)).toBeNull();
    expect(libraryReleaseTarget(series, 0)).toBeNull();
    expect(libraryReleaseTarget(series, 1, 0)).toBeNull();
    expect(libraryReleaseTarget(unmatched)).toBeNull();
  });
});
