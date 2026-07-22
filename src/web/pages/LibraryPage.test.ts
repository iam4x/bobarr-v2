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

  test("shows rating, storage, and live download information", () => {
    const markup = renderToStaticMarkup(
      LibraryCard({
        item: {
          ...movie,
          acquisitionState: "downloading",
          genres: [
            { id: 28, name: "Action" },
            { id: 878, name: "Science Fiction" },
            { id: 53, name: "Thriller" },
          ],
          rating: { source: "tmdb", value: 8.7, votes: 12_345 },
          storage: {
            libraryPath: null,
            downloadPath: "/media/downloads/The Matrix",
            fileCount: 1,
            totalBytes: 3_000_000_000,
            quality: "1080p",
          },
          activeDownload: {
            id: "download-1",
            state: "downloading",
            progress: 64.6,
            downloadedBytes: 1_500_000_000,
            totalBytes: 3_000_000_000,
            downloadRate: 12_500_000,
            etaSeconds: 3_900,
          },
        },
        onManage: () => undefined,
      }),
    );

    expect(markup).toContain('class="library-card__rating"');
    expect(markup).toContain("TMDB rating 8.7 out of 10");
    expect(markup).toContain("12k");
    expect(markup).toContain('aria-label="The Matrix download progress"');
    expect(markup).toContain("65%");
    expect(markup).toContain("1.50 GB of 3.00 GB");
    expect(markup).toContain("12.5 MB/s");
    expect(markup).toContain("ETA 1h 5m");
    expect(markup).toContain("Downloading to");
    expect(markup).toContain('title="/media/downloads/The Matrix"');
    expect(markup).toContain("1080p · 1 file · 3.00 GB");
    expect(markup).toContain("Science Fiction");
    expect(markup).toContain("+1");
  });

  test("shows television availability and the next air date", () => {
    const markup = renderToStaticMarkup(
      LibraryCard({
        item: {
          ...movie,
          id: "series-1",
          kind: "series",
          title: "The Expanse",
          acquisitionState: "available",
          episodeProgress: { available: 56, total: 62 },
          nextAirDate: "2026-08-14T00:00:00.000Z",
        },
        onManage: () => undefined,
      }),
    );

    expect(markup).toContain("56 of 62 episodes ready");
    expect(markup).toContain('aria-label="The Expanse episode availability"');
    expect(markup).toContain("Next episode");
  });

  test("uses concise recovery guidance for missing and failed media", () => {
    const missingMarkup = renderToStaticMarkup(
      LibraryCard({ item: movie, onManage: () => undefined }),
    );
    const failedMarkup = renderToStaticMarkup(
      LibraryCard({
        item: { ...movie, acquisitionState: "failed" },
        onManage: () => undefined,
      }),
    );

    expect(missingMarkup).toContain("No file yet · Open to find a release");
    expect(failedMarkup).toContain(
      "Acquisition needs attention · Open to retry",
    );
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
