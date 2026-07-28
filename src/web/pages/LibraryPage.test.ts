import type { LibraryItem } from "../types";

import { describe, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  canManuallySearchLibraryItem,
  defaultEpisodeReleaseTarget,
  defaultTvSeasonNumber,
  episodeDisplayStatus,
  LibraryCard,
  libraryPlaceholderData,
  LibrarySummary,
  libraryItemHasFile,
  libraryManualReleaseAction,
  libraryReleaseTarget,
  monitoringSeasonNumbers,
  MovieManagement,
  summarizeEpisodeStates,
  TvSeriesManagement,
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
  test("keeps library results mounted while a search refreshes", () => {
    const previous = { pages: [{ items: [movie] }] };

    expect(libraryPlaceholderData(previous, "movie", "movie")).toBe(previous);
    expect(libraryPlaceholderData(previous, "movie", "series")).toBe(undefined);
  });

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

  test("hides completed library health progress in show details", () => {
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(TvSeriesManagement, {
          item: {
            ...movie,
            id: "series-1",
            tmdbId: 1399,
            kind: "series",
            title: "The Expanse",
            acquisitionState: "available",
            episodeProgress: { available: 62, total: 62 },
          },
          downloadFiles: [],
          seasons: [],
          seasonsLoading: false,
          seasonsError: null,
          policy: "all",
          selectedSeasons: [],
          includeFutureSeasons: false,
          saveBusy: false,
          onPolicyChange: () => undefined,
          onSelectedSeasonsChange: () => undefined,
          onIncludeFutureSeasonsChange: () => undefined,
          onRetrySeasons: () => undefined,
          onSave: () => undefined,
          onManualSearch: () => undefined,
          onRemove: () => undefined,
        }),
      ),
    );

    expect(markup).toContain("62 of 62 monitored episodes are ready");
    expect(markup).not.toContain(
      'aria-label="The Expanse overall episode availability"',
    );
    expect(markup).not.toContain('class="tv-overview__progress"');
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

  test("opens the release picker instead of automatically replacing available media", () => {
    expect(
      libraryManualReleaseAction({
        ...movie,
        acquisitionState: "available",
      }),
    ).toBe("replace");
    expect(libraryManualReleaseAction(movie)).toBe("search");
    expect(
      libraryManualReleaseAction({
        ...movie,
        tmdbId: null,
        acquisitionState: "available",
      }),
    ).toBeNull();
  });

  test("treats a scan-imported movie as a replaceable library file", () => {
    const imported: LibraryItem = {
      ...movie,
      monitorPolicy: "none",
      acquisitionState: "available",
      storage: {
        libraryPath: "/media/movies/The Matrix (1999)/The Matrix (1999).mkv",
        downloadPath: null,
        fileCount: 1,
        totalBytes: 8_420_000_000,
        quality: "2160p",
      },
    };

    expect(libraryItemHasFile(imported)).toBe(true);
    expect(libraryManualReleaseAction(imported)).toBe("replace");

    const cardMarkup = renderToStaticMarkup(
      LibraryCard({ item: imported, onManage: () => undefined }),
    );
    expect(cardMarkup).toContain("Open to replace or manage files");

    const markup = renderToStaticMarkup(
      createElement(MovieManagement, {
        item: imported,
        downloadFiles: [
          {
            id: "file-1",
            mediaId: imported.id,
            name: "The Matrix (1999).mkv",
            sizeBytes: 8_420_000_000,
            downloadUrl: "/api/v1/library/movie-1/files/file-1/download",
          },
        ],
        policy: "none",
        saveBusy: false,
        retryBusy: false,
        onPolicyChange: () => undefined,
        onSave: () => undefined,
        onRetry: () => undefined,
        onManualSearch: () => undefined,
        onRemove: () => undefined,
      }),
    );

    expect(markup).toContain("Ready in your library");
    expect(markup).toContain("Choose replacement…");
    expect(markup).toContain("2160p · 1 file · 8.42 GB");
    expect(markup).toContain("Download movie");
    expect(markup).toContain(
      'href="/api/v1/library/movie-1/files/file-1/download"',
    );
    expect(markup).toContain("Remove from library…");
    expect(markup).not.toContain("Automatic monitoring");
    expect(markup).not.toContain("Retry automatic search");
  });

  test("uses stored files and active downloads to choose replacement actions", () => {
    expect(
      libraryManualReleaseAction({
        ...movie,
        acquisitionState: "unmonitored",
        monitorPolicy: "none",
        storage: {
          libraryPath: "/media/movies/The Matrix.mkv",
          downloadPath: null,
          fileCount: 1,
          totalBytes: 100,
          quality: null,
        },
      }),
    ).toBe("replace");
    expect(
      libraryManualReleaseAction({
        ...movie,
        acquisitionState: "downloading",
        activeDownload: {
          id: "download-1",
          state: "downloading",
          progress: 50,
          downloadedBytes: 50,
          totalBytes: 100,
          downloadRate: 10,
          etaSeconds: 5,
        },
      }),
    ).toBe("replace");
    expect(
      libraryManualReleaseAction({
        ...movie,
        acquisitionState: "available",
        monitorPolicy: "none",
        storage: {
          libraryPath: null,
          downloadPath: null,
          fileCount: 0,
          totalBytes: 0,
          quality: null,
        },
      }),
    ).toBeNull();
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

  test("defaults incomplete season searches to the earliest missing aired episode", () => {
    const season: LibraryItem = {
      ...movie,
      id: "season-1",
      kind: "season",
      parentId: "series-1",
      seasonNumber: 1,
      metadata: { acquisitionMode: "episodes" },
    };
    const episode = (
      episodeNumber: number,
      releaseDate: string | null,
      acquisitionState: LibraryItem["acquisitionState"] = "missing",
    ): LibraryItem => ({
      ...movie,
      id: `episode-${episodeNumber}`,
      kind: "episode",
      parentId: season.id,
      seasonNumber: 1,
      episodeNumber,
      releaseDate,
      acquisitionState,
    });

    expect(
      defaultEpisodeReleaseTarget(
        season,
        [
          episode(1, "2026-01-01T00:00:00.000Z", "available"),
          episode(2, "2026-02-01T00:00:00.000Z"),
          episode(3, null),
          episode(4, "2999-01-01T00:00:00.000Z"),
        ],
        Date.parse("2026-07-22T00:00:00.000Z"),
      ),
    ).toBe(2);
  });

  test("keeps season-pack selection for a fully aired season", () => {
    const season: LibraryItem = {
      ...movie,
      id: "season-1",
      kind: "season",
      parentId: "series-1",
      seasonNumber: 1,
      metadata: { acquisitionMode: "season" },
    };
    expect(
      defaultEpisodeReleaseTarget(
        season,
        [
          {
            ...movie,
            id: "episode-1",
            kind: "episode",
            parentId: season.id,
            seasonNumber: 1,
            episodeNumber: 1,
            releaseDate: "2020-01-01T00:00:00.000Z",
          },
        ],
        Date.parse("2026-07-22T00:00:00.000Z"),
      ),
    ).toBeNull();
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

  test("separates ready, active, aired-missing, upcoming, and TBA episodes", () => {
    const now = Date.parse("2026-07-22T18:00:00.000Z");
    const episode = (
      episodeNumber: number,
      acquisitionState: LibraryItem["acquisitionState"],
      releaseDate: string | null,
    ): LibraryItem => ({
      ...movie,
      id: `episode-${episodeNumber}`,
      kind: "episode",
      parentId: "season-1",
      seasonNumber: 8,
      episodeNumber,
      acquisitionState,
      releaseDate,
    });
    const episodes = [
      episode(1, "available", "2026-07-01T00:00:00.000Z"),
      episode(2, "downloading", "2026-07-08T00:00:00.000Z"),
      episode(3, "missing", "2026-07-15T00:00:00.000Z"),
      episode(4, "missing", "2026-07-22T00:00:00.000Z"),
      episode(5, "missing", "2026-07-29T00:00:00.000Z"),
      episode(6, "missing", null),
    ];

    expect(
      episodes.map((item) => episodeDisplayStatus(item, now).state),
    ).toEqual([
      "ready",
      "downloading",
      "missing",
      "upcoming",
      "upcoming",
      "tba",
    ]);
    expect(summarizeEpisodeStates(episodes, now)).toEqual({
      ready: 1,
      active: 1,
      missing: 1,
      upcoming: 3,
      unmonitored: 0,
      total: 6,
    });
  });

  test("keeps failures actionable and unmonitored episodes out of future counts", () => {
    const now = Date.parse("2026-07-22T18:00:00.000Z");
    const failed: LibraryItem = {
      ...movie,
      id: "episode-failed",
      kind: "episode",
      parentId: "season-1",
      seasonNumber: 8,
      episodeNumber: 3,
      acquisitionState: "failed",
      releaseDate: "2026-07-15T00:00:00.000Z",
    };
    const unmonitored: LibraryItem = {
      ...failed,
      id: "episode-unmonitored",
      monitorPolicy: "none",
      acquisitionState: "unmonitored",
    };

    expect(episodeDisplayStatus(failed, now)).toMatchObject({
      state: "failed",
      needsAttention: true,
    });
    expect(episodeDisplayStatus(unmonitored, now)).toMatchObject({
      state: "unmonitored",
      needsAttention: false,
    });
    expect(
      episodeDisplayStatus({
        ...unmonitored,
        id: "episode-imported",
        acquisitionState: "available",
        storage: {
          libraryPath: "/media/tv/Example/Season 01/episode.mkv",
          downloadPath: null,
          fileCount: 1,
          totalBytes: 1_000,
          quality: null,
        },
      }),
    ).toMatchObject({ state: "ready", needsAttention: false });
  });

  test("opens the latest aired season needing attention instead of a future season", () => {
    const now = Date.parse("2026-07-22T18:00:00.000Z");
    const season = (
      seasonNumber: number,
      acquisitionState: LibraryItem["acquisitionState"],
      releaseDate: string,
    ): LibraryItem => ({
      ...movie,
      id: `season-${seasonNumber}`,
      kind: "season",
      parentId: "series-1",
      seasonNumber,
      acquisitionState,
      releaseDate,
    });

    expect(
      defaultTvSeasonNumber(
        [
          season(7, "available", "2025-06-01T00:00:00.000Z"),
          season(8, "missing", "2026-05-01T00:00:00.000Z"),
          season(9, "missing", "2027-05-01T00:00:00.000Z"),
        ],
        now,
      ),
    ).toBe(8);
    expect(
      defaultTvSeasonNumber(
        [
          season(8, "missing", "2026-05-01T00:00:00.000Z"),
          season(9, "downloading", "2027-05-01T00:00:00.000Z"),
        ],
        now,
      ),
    ).toBe(9);
  });

  test("opens an imported unmonitored season that already has files", () => {
    const importedSeason = (seasonNumber: number, fileCount: number) => ({
      ...movie,
      id: `season-${seasonNumber}`,
      kind: "season" as const,
      parentId: "series-1",
      seasonNumber,
      monitorPolicy: "none" as const,
      acquisitionState: "available" as const,
      storage: {
        libraryPath: `/media/tv/Example/Season ${seasonNumber}`,
        downloadPath: null,
        fileCount,
        totalBytes: fileCount * 1_000,
        quality: null,
      },
    });

    expect(
      defaultTvSeasonNumber([importedSeason(1, 2), importedSeason(2, 4)]),
    ).toBe(2);
  });

  test("offers imported child seasons even without a metadata season count", () => {
    const season = (seasonNumber: number): LibraryItem => ({
      ...movie,
      id: `season-${seasonNumber}`,
      kind: "season",
      parentId: "series-1",
      seasonNumber,
      monitorPolicy: "none",
    });

    expect(monitoringSeasonNumbers([season(3), season(1)], 0)).toEqual([1, 3]);
    expect(monitoringSeasonNumbers([season(3)], 4)).toEqual([1, 2, 3, 4]);
  });
});
