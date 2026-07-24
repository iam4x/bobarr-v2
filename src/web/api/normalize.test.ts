import type {
  CalendarItem,
  CatalogItem,
  CatalogRecommendationsResponse,
  Job,
  LibraryItem,
  ReleaseCandidate,
} from "../types";

import { describe, expect, it } from "bun:test";

import {
  catalogPage,
  collectionItems,
  normalizeCatalogRecommendations,
} from "./normalize";

const title: CatalogItem = {
  id: "media-1",
  tmdbId: 1,
  kind: "movie",
  title: "A Film",
  overview: "",
};

describe("API collection normalization", () => {
  it("accepts direct arrays and items envelopes", () => {
    expect(collectionItems([title])).toEqual([title]);
    expect(collectionItems({ items: [title] })).toEqual([title]);
  });

  it("accepts every named collection used by the public API", () => {
    expect(collectionItems({ downloads: [title] })).toEqual([title]);
    expect(collectionItems({ jobs: [title] })).toEqual([title]);
    expect(collectionItems({ events: [title] })).toEqual([title]);
    expect(collectionItems({ candidates: [title] })).toEqual([title]);
  });

  it("normalizes TMDB-style result pagination", () => {
    expect(
      catalogPage({
        results: [title],
        page: 2,
        total_pages: 8,
        total_results: 160,
      }),
    ).toEqual({
      items: [title],
      page: 2,
      totalPages: 8,
      totalItems: 160,
    });
  });

  it("maps library storage fields to the presentation model", () => {
    const item = {
      id: "library-1",
      tmdbId: 1,
      kind: "movie",
      title: "A Film",
      year: 2026,
      posterUrl: "https://image.example/poster.jpg",
      status: "missing",
      monitorPolicy: "all",
      createdAt: "2026-07-03T20:00:00.000Z",
      metadata: {
        overview: "From metadata",
        voteAverage: 7.8,
        genres: [{ id: 18, name: "Drama" }],
        numberOfSeasons: 3,
      },
    } as unknown as LibraryItem;

    expect(collectionItems({ items: [item] })[0]).toMatchObject({
      posterPath: "https://image.example/poster.jpg",
      acquisitionState: "missing",
      overview: "From metadata",
      voteAverage: 7.8,
      genres: [{ id: 18, name: "Drama" }],
      numberOfSeasons: 3,
      addedAt: "2026-07-03T20:00:00.000Z",
    });
  });

  it("maps calendar events, durable jobs, and release sizes", () => {
    const calendar = {
      id: "calendar-1",
      title: "Episode 2",
      kind: "release",
      scheduledAt: "2026-08-03T20:00:00.000Z",
      libraryItemId: "library-1",
      status: "scheduled",
      metadata: {
        kind: "episode",
        subtitle: "S01E02",
        posterUrl: "https://image.example/show.jpg",
      },
    } as unknown as CalendarItem;
    const job = {
      id: "job-1",
      kind: "acquisition_search_v1",
      status: "failed",
      payload: {},
      message: "Indexer timed out",
      error: { attempt: 3, maxAttempts: 5, message: "Indexer timed out" },
      createdAt: "2026-08-03T20:00:00.000Z",
    } as unknown as Job;
    const release = {
      id: "rel_abcdefghijklmnopqrstuvwxyz123456",
      title: "A.Film.2026.1080p",
      eligible: true,
      sizeBytes: 4_000_000_000,
      reasons: [],
    } as unknown as ReleaseCandidate;

    expect(collectionItems({ events: [calendar] })[0]).toMatchObject({
      airDate: "2026-08-03T20:00:00.000Z",
      mediaId: "library-1",
      kind: "episode",
      subtitle: "S01E02",
      posterPath: "https://image.example/show.jpg",
      acquisitionState: "missing",
    });
    expect(collectionItems({ jobs: [job] })[0]).toMatchObject({
      type: "acquisition_search_v1",
      state: "failed",
      attempts: 3,
      maxAttempts: 5,
      error: "Indexer timed out",
    });
    expect(collectionItems({ candidates: [release] })[0]?.size).toBe(
      4_000_000_000,
    );
  });
});

describe("catalog recommendation normalization", () => {
  it("keeps a grouped response readable by the pre-grouping page normalizer", () => {
    const response: CatalogRecommendationsResponse = {
      groups: [
        {
          source: {
            id: "library-1",
            tmdbId: 603,
            kind: "movie",
            title: "The Matrix",
            year: 1999,
            posterUrl: null,
          },
          items: [title],
        },
      ],
      items: [title],
      page: 1,
      totalPages: 1,
      personalized: true,
      totalItems: 1,
      sourceTotal: 1,
      nextCursor: null,
    };

    expect(catalogPage(response)).toEqual({
      items: [title],
      page: 1,
      totalPages: 1,
      totalItems: 1,
    });
  });

  it("keeps valid grouped shelves and drops malformed groups", () => {
    expect(
      normalizeCatalogRecommendations({
        groups: [
          {
            source: {
              tmdbId: 603,
              kind: "movie",
              title: "The Matrix",
              year: 1999,
              posterPath: "/matrix.jpg",
            },
            items: [title],
          },
          {
            source: { tmdbId: 2, kind: "movie", title: "Broken" },
          },
        ],
        personalized: true,
        sourceTotal: 2,
        nextCursor: 3,
      }),
    ).toEqual({
      groups: [
        {
          source: {
            id: "library:movie:603",
            tmdbId: 603,
            kind: "movie",
            title: "The Matrix",
            year: 1999,
            posterUrl: "/matrix.jpg",
          },
          items: [title],
        },
      ],
      items: [title],
      page: 1,
      totalPages: 1,
      personalized: true,
      totalItems: 1,
      sourceTotal: 2,
      nextCursor: 3,
    });
  });

  it("turns the legacy flat payload into safe generic shelves", () => {
    const television: CatalogItem = {
      ...title,
      id: "series-2",
      tmdbId: 2,
      kind: "series",
      title: "A Show",
    };

    const normalized = normalizeCatalogRecommendations({
      items: [title, television],
      personalized: true,
      totalItems: 2,
    });

    expect(normalized).toMatchObject({
      items: [title, television],
      page: 1,
      totalPages: 1,
      personalized: false,
      totalItems: 2,
      sourceTotal: 0,
      nextCursor: null,
    });
    expect(
      normalized.groups.map((group) => ({
        id: group.source.id,
        kind: group.source.kind,
        items: group.items.map((item) => item.id),
      })),
    ).toEqual([
      {
        id: "legacy-library-mix:movie",
        kind: "movie",
        items: ["media-1"],
      },
      {
        id: "legacy-library-mix:series",
        kind: "series",
        items: ["series-2"],
      },
    ]);
  });
});
