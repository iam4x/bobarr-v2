import type { BackendConfig } from "../config";
import type { BackendRuntime } from "./initialize";

import { afterEach, describe, expect, test } from "bun:test";

import {
  enqueueMissingMedia,
  initializeBackend,
  refreshFutureSeasons,
} from "./initialize";
import {
  ApiErrorEnvelopeSchema,
  AuthSessionSchema,
  CreateDownloadInputSchema,
  CreateLibraryFileInputSchema,
  CreateLibraryItemRequestSchema,
} from "../../contracts";
import {
  ADD_TORRENT_JOB,
  downloadRepositoryFromDatabase,
} from "../application";
import { createEncryptionKey } from "../config";

const INFO_HASH = "0123456789abcdef0123456789abcdef01234567";
const TRACKER_SECRET = "tracker-passkey-super-secret";
const MAGNET_URI =
  `magnet:?xt=urn:btih:${INFO_HASH}` +
  `&dn=The.Matrix.1999.1080p.WEB-DL.x265-GRP` +
  `&tr=${encodeURIComponent(`https://tracker.example/announce?passkey=${TRACKER_SECRET}`)}`;
const NATIVE_FETCH = globalThis.fetch;

const runtimes: BackendRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  globalThis.fetch = NATIVE_FETCH;
});

describe("public product API", () => {
  test("documents normalized catalog ratings in OpenAPI", async () => {
    const fixture = await createFixture();
    const response = await fixture.runtime.app.request("/api/openapi.json");
    const document = (await response.json()) as {
      components?: { schemas?: Record<string, unknown> };
      paths?: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(document.components?.schemas?.["CatalogRatings"]).toMatchObject({
      type: "object",
      properties: {
        imdb: {
          type: ["object", "null"],
          properties: { value: { minimum: 0, maximum: 10 } },
        },
        rottenTomatoes: {
          type: ["object", "null"],
          properties: { value: { minimum: 0, maximum: 100 } },
        },
      },
    });
    expect(document.paths).toHaveProperty("/api/v1/catalog/{kind}/{tmdbId}");
  });

  test("documents bounded Discover filters and catalog configuration", async () => {
    const fixture = await createFixture();
    const response = await fixture.runtime.app.request("/api/openapi.json");
    const document = (await response.json()) as {
      paths?: Record<
        string,
        {
          get?: {
            parameters?: Array<{
              name?: string;
              schema?: Record<string, unknown>;
            }>;
          };
        }
      >;
    };
    const parameters =
      document.paths?.["/api/v1/catalog/discover"]?.get?.parameters ?? [];
    const byName = new Map(
      parameters.map((parameter) => [parameter.name, parameter.schema]),
    );

    expect([...byName.keys()]).toEqual(
      expect.arrayContaining([
        "kind",
        "sort",
        "page",
        "genres",
        "originCountry",
        "originalLanguage",
        "year",
        "dateFrom",
        "dateTo",
        "runtimeMin",
        "runtimeMax",
        "voteCountMin",
        "ratingMin",
      ]),
    );
    expect(byName.get("voteCountMin")).toMatchObject({
      minimum: 0,
      maximum: 100_000_000,
    });
    expect(byName.get("ratingMin")).toMatchObject({
      minimum: 0,
      maximum: 10,
    });
    expect(byName.get("sort")?.["enum"]).toContain("vote_average.desc");
    expect(document.paths).toHaveProperty("/api/v1/catalog/genres");
    expect(document.paths).toHaveProperty("/api/v1/catalog/languages");
    expect(document.paths).toHaveProperty("/api/v1/catalog/countries");
  });

  test("maps TMDB multi-search results into the public catalog shape", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);

    const response = await fixture.runtime.app.request(
      "/api/v1/catalog/search?query=Matrix&page=1",
      { headers: { cookie: session.cookie } },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<Record<string, unknown>>;
      page: number;
      totalPages: number;
      totalItems: number;
    };
    expect(body).toMatchObject({ page: 1, totalPages: 1, totalItems: 3 });
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      id: "movie:603",
      tmdbId: 603,
      kind: "movie",
      title: "The Matrix",
      originalTitle: "The Matrix",
      posterPath: "/matrix-poster.jpg",
      backdropPath: "/matrix-backdrop.jpg",
      releaseDate: "1999-03-30",
      year: 1999,
      voteAverage: 8.2,
      monitored: false,
    });
    expect(body.items[1]).toMatchObject({
      id: "series:1399",
      tmdbId: 1399,
      kind: "series",
      title: "Game of Thrones",
      year: 2011,
    });
    expect(JSON.stringify(body)).not.toContain("tmdb-test-key");
    expect(fixture.services.tmdbRequests[0]?.searchParams.get("query")).toBe(
      "Matrix",
    );
    expect(fixture.services.tmdbRequests[0]?.searchParams.get("language")).toBe(
      "en",
    );
  });

  test("maps rich Discover filters and applies the highest-rated vote floor", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);

    const seriesResponse = await fixture.runtime.app.request(
      "/api/v1/catalog/discover?kind=series&sort=vote_average.desc&page=2&genres=18%2C10765&originCountry=GB&originalLanguage=en&dateFrom=2020-01-01&dateTo=2025-12-31&runtimeMin=30&runtimeMax=90&ratingMin=7.5",
      { headers: { cookie: session.cookie } },
    );
    const explicitZeroResponse = await fixture.runtime.app.request(
      "/api/v1/catalog/discover?kind=movie&sort=vote_average.desc&voteCountMin=0",
      { headers: { cookie: session.cookie } },
    );
    const discoverRequests = fixture.services.tmdbRequests.filter((request) =>
      request.pathname.startsWith("/3/discover/"),
    );
    const series = discoverRequests[0]!.searchParams;
    const movie = discoverRequests[1]!.searchParams;

    expect(seriesResponse.status).toBe(200);
    expect(await seriesResponse.json()).toMatchObject({
      page: 2,
      totalPages: 3,
      items: [{ kind: "series", tmdbId: 1399 }],
    });
    expect(series.get("with_genres")).toBe("18|10765");
    expect(series.get("with_origin_country")).toBe("GB");
    expect(series.get("with_original_language")).toBe("en");
    expect(series.get("first_air_date.gte")).toBe("2020-01-01");
    expect(series.get("first_air_date.lte")).toBe("2025-12-31");
    expect(series.get("with_runtime.gte")).toBe("30");
    expect(series.get("with_runtime.lte")).toBe("90");
    expect(series.get("vote_average.gte")).toBe("7.5");
    expect(series.get("vote_count.gte")).toBe("200");
    expect(series.has("region")).toBe(false);
    expect(explicitZeroResponse.status).toBe(200);
    expect(movie.get("vote_count.gte")).toBe("0");
  });

  test("rejects contradictory Discover filters before calling TMDB", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    const before = fixture.services.tmdbRequests.length;

    const runtimeResponse = await fixture.runtime.app.request(
      "/api/v1/catalog/discover?runtimeMin=120&runtimeMax=60",
      { headers: { cookie: session.cookie } },
    );
    const dateResponse = await fixture.runtime.app.request(
      "/api/v1/catalog/discover?year=2024&dateFrom=2024-01-01",
      { headers: { cookie: session.cookie } },
    );
    const sortResponse = await fixture.runtime.app.request(
      "/api/v1/catalog/discover?kind=series&sort=revenue.desc",
      { headers: { cookie: session.cookie } },
    );
    const emptyVoteCountResponse = await fixture.runtime.app.request(
      "/api/v1/catalog/discover?sort=vote_average.desc&voteCountMin=",
      { headers: { cookie: session.cookie } },
    );

    expect(runtimeResponse.status).toBe(422);
    expect(dateResponse.status).toBe(422);
    expect(sortResponse.status).toBe(422);
    expect(emptyVoteCountResponse.status).toBe(422);
    expect(fixture.services.tmdbRequests).toHaveLength(before);
  });

  test("serves localized TMDB countries for typed Discover controls", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);

    const response = await fixture.runtime.app.request(
      "/api/v1/catalog/countries",
      { headers: { cookie: session.cookie } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        { code: "FR", englishName: "France", nativeName: "France" },
        {
          code: "US",
          englishName: "United States of America",
          nativeName: "United States",
        },
      ],
    });
    const request = fixture.services.tmdbRequests.find(
      (candidate) => candidate.pathname === "/3/configuration/countries",
    );
    expect(request?.searchParams.get("language")).toBe("en");
  });

  test("enriches catalog details with cached optional OMDb ratings", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);

    const first = await fixture.runtime.app.request(
      "/api/v1/catalog/movie/603",
      { headers: { cookie: session.cookie } },
    );
    const second = await fixture.runtime.app.request(
      "/api/v1/catalog/movie/603",
      { headers: { cookie: session.cookie } },
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({
      id: "movie:603",
      ratings: {
        imdb: { value: 8.7, scale: 10, votes: 2_107_348 },
        rottenTomatoes: { value: 83, scale: 100 },
      },
    });
    expect(fixture.services.omdbRequests).toHaveLength(1);
    expect(fixture.services.omdbRequests[0]?.searchParams.get("i")).toBe(
      "tt0133093",
    );
    expect(fixture.services.omdbRequests[0]?.searchParams.get("apikey")).toBe(
      "omdb-test-key",
    );
    expect(JSON.stringify(await second.json())).not.toContain("omdb-test-key");
  });

  test("keeps TMDB details available when optional OMDb is degraded", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    fixture.services.omdbFails = true;

    const response = await fixture.runtime.app.request(
      "/api/v1/catalog/movie/603",
      { headers: { cookie: session.cookie } },
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: "movie:603", title: "The Matrix" });
    expect(body["ratings"]).toBeUndefined();
  });

  test("monitoring a movie persists it and creates durable acquisition work", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);

    const response = await jsonRequest(
      fixture.runtime,
      "/api/v1/library",
      "POST",
      { tmdbId: 603, kind: "movie", monitorPolicy: "all" },
      session,
    );

    expect(response.status).toBe(201);
    const item = (await response.json()) as {
      id: string;
      tmdbId: number;
      kind: string;
      title: string;
      acquisitionState: string;
    };
    expect(item).toMatchObject({
      tmdbId: 603,
      kind: "movie",
      title: "The Matrix",
      acquisitionState: "missing",
    });
    expect(fixture.runtime.repositories.media.get(item.id)).toMatchObject({
      tmdbId: 603,
      monitorPolicy: "all",
      acquisitionState: "missing",
    });

    const jobs = await fixture.runtime.queue.list({
      types: ["media.acquire.v1"],
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      type: "media.acquire.v1",
      payload: { version: 1, mediaId: item.id },
      dedupeKey: item.id,
      maxAttempts: 5,
    });
  });

  test("projects current media state and hides untracked calendar events", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    const movie = fixture.runtime.repositories.media.create(
      CreateLibraryItemRequestSchema.parse({
        kind: "movie",
        tmdbId: 603,
        title: "The Matrix",
        status: "missing",
        monitorPolicy: "all",
        releaseDate: "1999-03-30T00:00:00.000Z",
      }),
    );
    const created = fixture.runtime.repositories.calendar.create({
      title: movie.title,
      kind: "release",
      scheduledAt: movie.releaseDate!,
      libraryItemId: movie.id,
      status: "scheduled",
      metadata: { acquisitionState: "missing" },
    });
    fixture.runtime.repositories.media.updateState(movie.id, "available");

    const response = await fixture.runtime.app.request(
      "/api/v1/calendar?from=1999-03-01T00%3A00%3A00.000Z&to=1999-04-01T00%3A00%3A00.000Z",
      { headers: { cookie: session.cookie } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      events: [
        {
          id: created.id,
          libraryItemId: movie.id,
          metadata: { acquisitionState: "available" },
        },
      ],
    });

    const untracked = await jsonRequest(
      fixture.runtime,
      `/api/v1/library/${movie.id}`,
      "PATCH",
      { monitorPolicy: "none" },
      session,
    );
    expect(untracked.status).toBe(200);

    const afterUntracking = await fixture.runtime.app.request(
      "/api/v1/calendar?from=1999-03-01T00%3A00%3A00.000Z&to=1999-04-01T00%3A00%3A00.000Z",
      { headers: { cookie: session.cookie } },
    );
    expect(afterUntracking.status).toBe(200);
    expect(await afterUntracking.json()).toEqual({ events: [] });
  });

  test("keeps removed movies out of calendar across re-add cycles", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    const calendarUrl =
      "/api/v1/calendar?from=1999-03-01T00%3A00%3A00.000Z&to=1999-04-01T00%3A00%3A00.000Z";
    const legacyMovie = fixture.runtime.repositories.media.create(
      CreateLibraryItemRequestSchema.parse({
        kind: "movie",
        tmdbId: 603,
        title: "The Matrix",
        status: "missing",
        monitorPolicy: "all",
        releaseDate: "1999-03-30T00:00:00.000Z",
      }),
    );
    const firstEvent = fixture.runtime.repositories.calendar.create({
      title: legacyMovie.title,
      kind: "release",
      scheduledAt: legacyMovie.releaseDate!,
      libraryItemId: legacyMovie.id,
      status: "scheduled",
      metadata: { mediaKind: "movie" },
    });
    const repeatedEvent = fixture.runtime.repositories.calendar.create({
      title: legacyMovie.title,
      kind: "release",
      scheduledAt: legacyMovie.releaseDate!,
      libraryItemId: legacyMovie.id,
      status: "scheduled",
      metadata: { mediaKind: "movie", refreshed: true },
    });
    expect(repeatedEvent.id).toBe(firstEvent.id);

    // Reproduce databases created before calendar rows were cleaned on removal.
    expect(fixture.runtime.repositories.media.delete(legacyMovie.id)).toBe(
      true,
    );
    const afterLegacyRemoval = await fixture.runtime.app.request(calendarUrl, {
      headers: { cookie: session.cookie },
    });
    expect(await afterLegacyRemoval.json()).toEqual({ events: [] });

    const readded = await jsonRequest(
      fixture.runtime,
      "/api/v1/library",
      "POST",
      { tmdbId: 603, kind: "movie", monitorPolicy: "all" },
      session,
    );
    expect(readded.status).toBe(201);
    const readdedMovie = (await readded.json()) as { id: string };
    const afterReadding = await fixture.runtime.app.request(calendarUrl, {
      headers: { cookie: session.cookie },
    });
    const readdedCalendar = (await afterReadding.json()) as {
      events: Array<{ libraryItemId: string | null; title: string }>;
    };
    expect(readdedCalendar.events).toHaveLength(1);
    expect(readdedCalendar.events[0]).toMatchObject({
      libraryItemId: readdedMovie.id,
      title: "The Matrix",
    });

    const removedAgain = await jsonRequest(
      fixture.runtime,
      `/api/v1/library/${readdedMovie.id}`,
      "DELETE",
      {
        deleteLibraryFiles: true,
        deleteTorrent: true,
        deleteDownloadData: true,
      },
      session,
    );
    expect(removedAgain.status).toBe(200);
    expect(await removedAgain.json()).toMatchObject({ deleted: true });
    const afterRemovingAgain = await fixture.runtime.app.request(calendarUrl, {
      headers: { cookie: session.cookie },
    });
    expect(await afterRemovingAgain.json()).toEqual({ events: [] });
  });

  test("searches releases for an imported item without a release date", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    const imported = fixture.runtime.repositories.media.create(
      CreateLibraryItemRequestSchema.parse({
        kind: "movie",
        tmdbId: 603,
        title: "The Matrix",
        year: 1999,
        status: "available",
        monitorPolicy: "none",
        releaseDate: null,
        metadata: { imported: true },
      }),
    );

    const response = await fixture.runtime.app.request(
      "/api/v1/releases?tmdbId=603&kind=movie",
      { headers: { cookie: session.cookie } },
    );
    const body = (await response.json()) as {
      items: Array<{ mediaId: string | null; eligible: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(body.items[0]).toMatchObject({
      mediaId: imported.id,
      eligible: true,
    });
    expect(
      fixture.services.tmdbRequests.some(
        (request) => request.pathname === "/3/movie/603",
      ),
    ).toBe(false);
  });

  test("applies required terms to manual and automatic acquisition", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    const settingsResponse = await jsonRequest(
      fixture.runtime,
      "/api/v1/settings",
      "PATCH",
      { acquisition: { requiredTerms: ["proper"] } },
      session,
    );
    expect(settingsResponse.status).toBe(200);

    const manualResponse = await fixture.runtime.app.request(
      "/api/v1/releases?tmdbId=603&kind=movie",
      { headers: { cookie: session.cookie } },
    );
    const manual = (await manualResponse.json()) as {
      items: Array<{ eligible: boolean; reasons: string[] }>;
    };
    expect(manualResponse.status).toBe(200);
    expect(manual.items[0]).toMatchObject({
      eligible: false,
      reasons: ["required term missing: proper"],
    });

    const monitoredResponse = await jsonRequest(
      fixture.runtime,
      "/api/v1/library",
      "POST",
      { tmdbId: 603, kind: "movie", monitorPolicy: "all" },
      session,
    );
    const monitored = (await monitoredResponse.json()) as { id: string };
    const job = (
      await fixture.runtime.queue.list({
        types: ["media.acquire.v1"],
      })
    ).find(
      (candidate) =>
        typeof candidate.payload === "object" &&
        candidate.payload !== null &&
        "mediaId" in candidate.payload &&
        candidate.payload.mediaId === monitored.id,
    );
    const handler = fixture.runtime.acquisition.handlers["media.acquire.v1"];
    if (!job || !handler) throw new Error("Expected an acquisition job");
    await handler(job, {
      signal: new AbortController().signal,
      heartbeat: async () => undefined,
    });

    expect(fixture.runtime.repositories.media.get(monitored.id)).toMatchObject({
      acquisitionState: "missing",
    });
    expect(
      fixture.runtime.repositories.downloads.list({
        limit: 50,
        offset: 0,
        mediaId: monitored.id,
      }).downloads,
    ).toEqual([]);
  });

  test("shows future air-date exclusions manually and never auto-selects them", async () => {
    const fixture = await createFixture();
    fixture.services.seasonAirYear = 2999;
    const session = await setup(fixture.runtime);
    const futureDate = "2999-04-01T00:00:00.000Z";
    const previewResponse = await fixture.runtime.app.request(
      "/api/v1/releases?tmdbId=1399&kind=series&season=4&episode=1",
      { headers: { cookie: session.cookie } },
    );
    const preview = (await previewResponse.json()) as {
      items: Array<{ eligible: boolean; reasons: string[] }>;
    };
    expect(previewResponse.status).toBe(200);
    expect(preview.items[0]?.reasons).toContain(
      `media is not released until ${futureDate}`,
    );

    const monitorResponse = await jsonRequest(
      fixture.runtime,
      "/api/v1/library",
      "POST",
      {
        tmdbId: 1399,
        kind: "series",
        monitorPolicy: "selected",
        seasonNumbers: [4],
      },
      session,
    );
    const parent = (await monitorResponse.json()) as { id: string };
    const season = fixture.runtime.repositories.media.children(parent.id)[0]!;
    const episode = fixture.runtime.repositories.media.children(season.id)[0]!;

    const manualResponse = await fixture.runtime.app.request(
      "/api/v1/releases?tmdbId=1399&kind=series&season=4&episode=1",
      { headers: { cookie: session.cookie } },
    );
    const manual = (await manualResponse.json()) as {
      items: Array<{ eligible: boolean; reasons: string[] }>;
    };
    expect(manualResponse.status).toBe(200);
    expect(manual.items[0]?.eligible).toBe(false);
    expect(manual.items[0]?.reasons).toContain(
      `media is not released until ${futureDate}`,
    );

    const job = await fixture.runtime.queue.enqueue({
      type: "media.acquire.v1",
      payload: { version: 1, mediaId: episode.id },
      dedupeKey: `future-episode:${episode.id}`,
      maxAttempts: 1,
    });
    const handler = fixture.runtime.acquisition.handlers["media.acquire.v1"];
    if (!handler) throw new Error("Expected an acquisition handler");
    await handler(job, {
      signal: new AbortController().signal,
      heartbeat: async () => undefined,
    });

    expect(fixture.runtime.repositories.media.get(episode.id)).toMatchObject({
      acquisitionState: "missing",
    });
    expect(
      fixture.runtime.repositories.downloads.list({
        limit: 50,
        offset: 0,
        mediaId: episode.id,
      }).downloads,
    ).toEqual([]);
  });

  test("builds recommendations from monitored titles", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    await jsonRequest(
      fixture.runtime,
      "/api/v1/library",
      "POST",
      { tmdbId: 603, kind: "movie", monitorPolicy: "all" },
      session,
    );

    const response = await fixture.runtime.app.request(
      "/api/v1/catalog/recommendations",
      { headers: { cookie: session.cookie } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      personalized: true,
      items: [
        {
          id: "movie:329865",
          title: "Arrival",
          monitored: false,
        },
      ],
    });
    expect(
      fixture.services.tmdbRequests.some(
        (url) => url.pathname === "/3/movie/603/recommendations",
      ),
    ).toBe(true);
  });

  test("tracks future TV seasons and binds manual releases to the selected hierarchy", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);

    const monitorResponse = await jsonRequest(
      fixture.runtime,
      "/api/v1/library",
      "POST",
      { tmdbId: 1399, kind: "series", monitorPolicy: "future" },
      session,
    );
    expect(monitorResponse.status).toBe(201);
    const parent = (await monitorResponse.json()) as {
      id: string;
      metadata: Record<string, unknown>;
    };
    expect(parent.metadata["includeFutureSeasons"]).toBe(true);

    const seasons = fixture.runtime.repositories.media.children(parent.id);
    expect(seasons).toHaveLength(1);
    expect(seasons[0]).toMatchObject({
      kind: "season",
      seasonNumber: 4,
      monitorPolicy: "selected",
      acquisitionState: "missing",
    });
    const seasonFour = seasons[0]!;
    const initialEpisodes = fixture.runtime.repositories.media.children(
      seasonFour.id,
    );
    expect(initialEpisodes.map((episode) => episode.episodeNumber)).toEqual([
      1,
    ]);

    const detailsResponse = await fixture.runtime.app.request(
      "/api/v1/catalog/series/1399",
      { headers: { cookie: session.cookie } },
    );
    expect(detailsResponse.status).toBe(200);
    expect(await detailsResponse.json()).toMatchObject({
      numberOfSeasons: 4,
      monitoredSeasonNumbers: [4],
    });

    const latestReleasesResponse = await fixture.runtime.app.request(
      "/api/v1/releases?tmdbId=1399&kind=series",
      { headers: { cookie: session.cookie } },
    );
    expect(latestReleasesResponse.status).toBe(200);
    const latestReleases = (await latestReleasesResponse.json()) as {
      items: Array<{ mediaId: string | null; eligible: boolean }>;
      query: string;
    };
    expect(latestReleases.query).toBe("Game of Thrones S04");
    expect(latestReleases.items[0]).toMatchObject({
      mediaId: seasonFour.id,
      eligible: true,
    });
    const editedQuery = "Game of Thrones S04E01 PROPER";
    const episodeReleasesResponse = await fixture.runtime.app.request(
      `/api/v1/releases?tmdbId=1399&kind=series&season=4&episode=1&query=${encodeURIComponent(editedQuery)}`,
      { headers: { cookie: session.cookie } },
    );
    expect(episodeReleasesResponse.status).toBe(200);
    const episodeReleases = (await episodeReleasesResponse.json()) as {
      items: Array<{ mediaId: string | null; eligible: boolean }>;
      query: string;
      mediaId: string | null;
    };
    expect(episodeReleases.query).toBe(editedQuery);
    expect(episodeReleases.mediaId).toBe(initialEpisodes[0]!.id);
    expect(episodeReleases.items[0]).toMatchObject({
      mediaId: initialEpisodes[0]!.id,
      eligible: true,
    });
    expect(fixture.services.jackettRequests.at(-1)?.searchParams.get("q")).toBe(
      editedQuery,
    );

    const unmonitoredSeason = await fixture.runtime.app.request(
      "/api/v1/releases?tmdbId=1399&kind=series&season=3",
      { headers: { cookie: session.cookie } },
    );
    expect(unmonitoredSeason.status).toBe(400);

    const tmdb = await fixture.runtime.integrations.tmdb();
    fixture.services.seriesEpisodeCount = 2;
    let details = await tmdb.details("tv", 1399);
    const episodeChanges = await refreshFutureSeasons({
      parent: fixture.runtime.repositories.media.get(parent.id)!,
      details,
      repositories: fixture.runtime.repositories,
      queue: fixture.runtime.queue,
      client: tmdb,
      language: "en",
    });
    expect(episodeChanges.map((season) => season.seasonNumber)).toEqual([4]);
    expect(
      fixture.runtime.repositories.media
        .children(seasonFour.id)
        .map((episode) => episode.episodeNumber),
    ).toEqual([1, 2]);

    fixture.services.seriesSeasonCount = 5;
    details = await tmdb.details("tv", 1399);
    const seasonChanges = await refreshFutureSeasons({
      parent: fixture.runtime.repositories.media.get(parent.id)!,
      details,
      repositories: fixture.runtime.repositories,
      queue: fixture.runtime.queue,
      client: tmdb,
      language: "en",
    });
    expect(seasonChanges.map((season) => season.seasonNumber)).toEqual([5]);
    expect(
      fixture.runtime.repositories.media
        .children(parent.id)
        .map((season) => season.seasonNumber),
    ).toEqual([4, 5]);
    expect(
      fixture.runtime.repositories.media.children(seasonChanges[0]!.id),
    ).toHaveLength(2);

    const repeated = await refreshFutureSeasons({
      parent: fixture.runtime.repositories.media.get(parent.id)!,
      details,
      repositories: fixture.runtime.repositories,
      queue: fixture.runtime.queue,
      client: tmdb,
      language: "en",
    });
    expect(repeated).toEqual([]);

    await enqueueMissingMedia(
      fixture.runtime.queue,
      fixture.runtime.repositories,
    );
    const acquisitionJobs = await fixture.runtime.queue.list({
      types: ["media.acquire.v1"],
      limit: 100,
    });
    const episodeIds = new Set(
      fixture.runtime.repositories.media
        .children(seasonFour.id)
        .map((episode) => episode.id),
    );
    expect(
      acquisitionJobs.some(
        (job) =>
          typeof job.payload === "object" &&
          job.payload !== null &&
          "mediaId" in job.payload &&
          typeof job.payload.mediaId === "string" &&
          episodeIds.has(job.payload.mediaId),
      ),
    ).toBe(true);
  });

  test("refreshes new episodes in selected seasons without opting into future seasons", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    const response = await jsonRequest(
      fixture.runtime,
      "/api/v1/library",
      "POST",
      {
        tmdbId: 1399,
        kind: "series",
        monitorPolicy: "selected",
        seasonNumbers: [4],
        includeFutureSeasons: false,
      },
      session,
    );
    const parent = (await response.json()) as { id: string };
    const season = fixture.runtime.repositories.media.children(parent.id)[0]!;
    const originalEpisodeIds = new Set(
      fixture.runtime.repositories.media
        .children(season.id)
        .map((episode) => episode.id),
    );
    fixture.services.seriesEpisodeCount = 2;
    fixture.services.seriesSeasonCount = 5;
    const tmdb = await fixture.runtime.integrations.tmdb();
    const changes = await refreshFutureSeasons({
      parent: fixture.runtime.repositories.media.get(parent.id)!,
      details: await tmdb.details("tv", 1399),
      repositories: fixture.runtime.repositories,
      queue: fixture.runtime.queue,
      client: tmdb,
      language: "en",
    });

    expect(changes.map((item) => item.seasonNumber)).toEqual([4]);
    expect(
      fixture.runtime.repositories.media
        .children(parent.id)
        .map((item) => item.seasonNumber),
    ).toEqual([4]);
    const newEpisode = fixture.runtime.repositories.media
      .children(season.id)
      .find((episode) => !originalEpisodeIds.has(episode.id));
    expect(newEpisode?.metadata["incrementalAcquisition"]).toBe(true);
    expect(
      (await fixture.runtime.queue.list({ types: ["media.acquire.v1"] })).some(
        (job) =>
          typeof job.payload === "object" &&
          job.payload !== null &&
          "mediaId" in job.payload &&
          job.payload.mediaId === newEpisode?.id,
      ),
    ).toBe(true);
  });

  test("supports explicit multi-season selection and later monitoring changes", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);

    const monitorResponse = await jsonRequest(
      fixture.runtime,
      "/api/v1/library",
      "POST",
      {
        tmdbId: 1399,
        kind: "series",
        monitorPolicy: "selected",
        seasonNumbers: [1, 2],
        includeFutureSeasons: false,
      },
      session,
    );
    expect(monitorResponse.status).toBe(201);
    const parent = (await monitorResponse.json()) as { id: string };
    expect(
      fixture.runtime.repositories.media
        .children(parent.id)
        .map((season) => season.seasonNumber),
    ).toEqual([1, 2]);

    const updateResponse = await jsonRequest(
      fixture.runtime,
      `/api/v1/library/${parent.id}`,
      "PATCH",
      {
        monitorPolicy: "selected",
        seasonNumbers: [2, 3],
        includeFutureSeasons: true,
      },
      session,
    );
    expect(updateResponse.status).toBe(200);
    const seasons = fixture.runtime.repositories.media.children(parent.id);
    expect(
      seasons.map((season) => [
        season.seasonNumber,
        season.monitorPolicy,
        season.acquisitionState,
      ]),
    ).toEqual([
      [1, "none", "unmonitored"],
      [2, "selected", "missing"],
      [3, "selected", "missing"],
    ]);
    expect(
      fixture.runtime.repositories.media.get(parent.id)?.metadata[
        "includeFutureSeasons"
      ],
    ).toBe(true);
  });

  test("re-monitoring an imported movie preserves its available state", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    const imported = fixture.runtime.repositories.media.create({
      kind: "movie",
      tmdbId: 603,
      parentId: null,
      seasonNumber: null,
      episodeNumber: null,
      title: "The Matrix",
      year: 1999,
      posterUrl: null,
      status: "available",
      monitorPolicy: "none",
      releaseDate: null,
      metadata: { imported: true },
    });

    const response = await jsonRequest(
      fixture.runtime,
      "/api/v1/library",
      "POST",
      { tmdbId: 603, kind: "movie", monitorPolicy: "all" },
      session,
    );

    expect(response.status).toBe(200);
    expect(fixture.runtime.repositories.media.get(imported.id)).toMatchObject({
      monitorPolicy: "all",
      acquisitionState: "available",
    });
  });

  test("queues an explicit replacement while preserving the organized file", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    const monitored = await jsonRequest(
      fixture.runtime,
      "/api/v1/library",
      "POST",
      { tmdbId: 603, kind: "movie", monitorPolicy: "all" },
      session,
    );
    const movie = (await monitored.json()) as { id: string };
    fixture.runtime.repositories.media.updateState(movie.id, "available");
    fixture.runtime.repositories.libraryFiles.upsert(
      CreateLibraryFileInputSchema.parse({
        mediaId: movie.id,
        downloadId: null,
        path: "/media/movies/The Matrix (1999)/The Matrix (1999).mkv",
        sizeBytes: 100,
        quality: null,
        videoCodec: null,
        audioCodec: null,
        strategy: "hardlink",
      }),
    );

    const response = await jsonRequest(
      fixture.runtime,
      `/api/v1/library/${movie.id}/replace`,
      "POST",
      {},
      session,
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      accepted: true,
      downloadId: null,
      jobIds: [expect.any(String)],
    });
    expect(fixture.runtime.repositories.media.get(movie.id)).toMatchObject({
      acquisitionState: "searching",
      metadata: { replacementPending: true },
    });
    expect(
      fixture.runtime.repositories.libraryFiles.listForMedia(movie.id),
    ).toHaveLength(1);
  });

  test("replaces a queued candidate and cancels its pending add job", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    const monitored = await jsonRequest(
      fixture.runtime,
      "/api/v1/library",
      "POST",
      { tmdbId: 603, kind: "movie", monitorPolicy: "all" },
      session,
    );
    const movie = (await monitored.json()) as { id: string };
    const firstSearch = (await (
      await fixture.runtime.app.request(
        "/api/v1/releases?tmdbId=603&kind=movie",
        { headers: { cookie: session.cookie } },
      )
    ).json()) as { items: Array<{ id: string }> };
    const firstDownloadResponse = await jsonRequest(
      fixture.runtime,
      "/api/v1/downloads",
      "POST",
      { candidateId: firstSearch.items[0]!.id },
      session,
    );
    const firstDownload = (await firstDownloadResponse.json()) as {
      id: string;
    };

    const editedQuery = "The Matrix 1999 2160p REMUX";
    const replacementSearch = (await (
      await fixture.runtime.app.request(
        `/api/v1/releases?tmdbId=603&kind=movie&query=${encodeURIComponent(editedQuery)}`,
        { headers: { cookie: session.cookie } },
      )
    ).json()) as {
      items: Array<{ id: string }>;
      query: string;
      mediaId: string | null;
      replacementRequired: boolean;
    };
    expect(replacementSearch).toMatchObject({
      query: editedQuery,
      mediaId: movie.id,
      replacementRequired: true,
    });

    const replaced = await jsonRequest(
      fixture.runtime,
      `/api/v1/library/${movie.id}/replace`,
      "POST",
      { candidateId: replacementSearch.items[0]!.id },
      session,
    );
    expect(replaced.status).toBe(202);
    const replacement = (await replaced.json()) as {
      downloadId: string;
    };
    expect(replacement.downloadId).toBeString();
    expect(replacement.downloadId).not.toBe(firstDownload.id);
    expect(fixture.runtime.repositories.downloads.get(firstDownload.id)).toBe(
      undefined,
    );
    expect(
      await downloadRepositoryFromDatabase(fixture.runtime.database).findById(
        firstDownload.id,
      ),
    ).toMatchObject({
      state: "removed",
      error: "Superseded by an explicit replacement",
    });
    expect(
      fixture.runtime.repositories.downloads.get(replacement.downloadId),
    ).toMatchObject({
      mediaId: movie.id,
      releaseCandidateId: replacementSearch.items[0]!.id,
      state: "queued",
    });
    const addJobs = await fixture.runtime.queue.list({
      types: [ADD_TORRENT_JOB],
      limit: 100,
    });
    expect(
      addJobs.find(
        (job) =>
          typeof job.payload === "object" &&
          job.payload !== null &&
          "downloadId" in job.payload &&
          job.payload.downloadId === firstDownload.id,
      )?.state,
    ).toBe("cancelled");
    expect(fixture.runtime.repositories.media.get(movie.id)).toMatchObject({
      monitorPolicy: "all",
      acquisitionState: "queued",
    });
    expect(
      fixture.services.transmissionCalls.some(
        (call) => call.method === "torrent_remove",
      ),
    ).toBe(false);
  });

  test("replaces only a downloading Bobarr-owned torrent and deletes its partial data", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    const monitored = await jsonRequest(
      fixture.runtime,
      "/api/v1/library",
      "POST",
      { tmdbId: 603, kind: "movie", monitorPolicy: "all" },
      session,
    );
    const movie = (await monitored.json()) as { id: string };
    const firstSearch = (await (
      await fixture.runtime.app.request(
        "/api/v1/releases?tmdbId=603&kind=movie",
        { headers: { cookie: session.cookie } },
      )
    ).json()) as { items: Array<{ id: string }> };
    const queued = await jsonRequest(
      fixture.runtime,
      "/api/v1/downloads",
      "POST",
      { candidateId: firstSearch.items[0]!.id },
      session,
    );
    const firstDownload = (await queued.json()) as { id: string };
    await (
      await fixture.runtime.acquisition.service()
    ).runAddJob(firstDownload.id);

    const replacementSearch = (await (
      await fixture.runtime.app.request(
        "/api/v1/releases?tmdbId=603&kind=movie&query=The%20Matrix%201999%20PROPER",
        { headers: { cookie: session.cookie } },
      )
    ).json()) as {
      items: Array<{ id: string }>;
      replacementRequired: boolean;
    };
    expect(replacementSearch.replacementRequired).toBe(true);
    const response = await jsonRequest(
      fixture.runtime,
      `/api/v1/library/${movie.id}/replace`,
      "POST",
      { candidateId: replacementSearch.items[0]!.id },
      session,
    );

    expect(response.status).toBe(202);
    expect(
      fixture.services.transmissionCalls.findLast(
        (call) => call.method === "torrent_remove",
      )?.params,
    ).toMatchObject({
      ids: [INFO_HASH],
      delete_local_data: true,
    });
    expect(
      await downloadRepositoryFromDatabase(fixture.runtime.database).findById(
        firstDownload.id,
      ),
    ).toMatchObject({ state: "removed" });
    expect(fixture.runtime.repositories.media.get(movie.id)).toMatchObject({
      monitorPolicy: "all",
      acquisitionState: "queued",
    });
  });

  test("refuses active replacement when Transmission ownership cannot be verified", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    const monitored = await jsonRequest(
      fixture.runtime,
      "/api/v1/library",
      "POST",
      { tmdbId: 603, kind: "movie", monitorPolicy: "all" },
      session,
    );
    const movie = (await monitored.json()) as { id: string };
    const firstSearch = (await (
      await fixture.runtime.app.request(
        "/api/v1/releases?tmdbId=603&kind=movie",
        { headers: { cookie: session.cookie } },
      )
    ).json()) as { items: Array<{ id: string }> };
    const queued = await jsonRequest(
      fixture.runtime,
      "/api/v1/downloads",
      "POST",
      { candidateId: firstSearch.items[0]!.id },
      session,
    );
    const firstDownload = (await queued.json()) as { id: string };
    await (
      await fixture.runtime.acquisition.service()
    ).runAddJob(firstDownload.id);
    const replacementSearch = (await (
      await fixture.runtime.app.request(
        "/api/v1/releases?tmdbId=603&kind=movie&query=The%20Matrix%201999%20REPACK",
        { headers: { cookie: session.cookie } },
      )
    ).json()) as { items: Array<{ id: string }> };
    fixture.services.replaceTorrentOwnership([]);

    const response = await jsonRequest(
      fixture.runtime,
      `/api/v1/library/${movie.id}/replace`,
      "POST",
      { candidateId: replacementSearch.items[0]!.id },
      session,
    );

    expect(response.status).toBe(409);
    expect(
      fixture.services.transmissionCalls.some(
        (call) => call.method === "torrent_remove",
      ),
    ).toBe(false);
    expect(
      fixture.runtime.repositories.downloads.list({
        mediaId: movie.id,
        limit: 100,
        offset: 0,
      }).downloads,
    ).toHaveLength(1);
    expect(
      await downloadRepositoryFromDatabase(fixture.runtime.database).findById(
        firstDownload.id,
      ),
    ).toMatchObject({ state: "downloading" });
  });

  test("keeps Jackett sources opaque and starts a candidate through Transmission", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);

    const releasesResponse = await fixture.runtime.app.request(
      "/api/v1/releases?tmdbId=603&kind=movie",
      { headers: { cookie: session.cookie } },
    );
    expect(releasesResponse.status).toBe(200);
    const releases = (await releasesResponse.json()) as {
      items: Array<{
        id: string;
        title: string;
        eligible: boolean;
        seeders: number;
      }>;
      expiresAt: string;
    };
    expect(releases.items).toHaveLength(1);
    const candidate = releases.items[0];
    expect(candidate).toMatchObject({
      title: "The.Matrix.1999.1080p.WEB-DL.x265-GRP",
      eligible: true,
      seeders: 42,
    });
    expect(candidate?.id).toBeString();
    expect(String(candidate?.id)).toMatch(/^rel_[A-Za-z0-9_-]{32,}$/);
    const publicReleaseJson = JSON.stringify(releases);
    expect(publicReleaseJson).not.toContain("magnet:?");
    expect(publicReleaseJson).not.toContain(TRACKER_SECRET);
    expect(publicReleaseJson).not.toContain("passkey=");

    const stored = fixture.runtime.database.sqlite
      .query(
        "SELECT protected_source_payload AS payload FROM release_candidates WHERE id = ?1",
      )
      .get(String(candidate?.id)) as { payload: string } | null;
    expect(stored).not.toBeNull();
    expect(stored?.payload).not.toContain("magnet:?");
    expect(stored?.payload).not.toContain(TRACKER_SECRET);

    const downloadResponse = await jsonRequest(
      fixture.runtime,
      "/api/v1/downloads",
      "POST",
      { candidateId: candidate?.id },
      session,
    );
    expect(downloadResponse.status).toBe(202);
    const download = (await downloadResponse.json()) as {
      id: string;
      releaseCandidateId: string;
      mediaId: string | null;
      client: string;
      externalId: string | null;
      title: string;
      state: string;
      progress: number;
      downloadPath: string;
    };
    expect(download).toMatchObject({
      releaseCandidateId: candidate?.id,
      mediaId: null,
      client: "transmission",
      externalId: null,
      title: "The.Matrix.1999.1080p.WEB-DL.x265-GRP",
      state: "queued",
      progress: 0,
      downloadPath: `/media/downloads/${download.id}`,
    });
    const publicDownloadJson = JSON.stringify(download);
    expect(publicDownloadJson).not.toContain("sourceCiphertext");
    expect(publicDownloadJson).not.toContain("magnet:?");
    expect(publicDownloadJson).not.toContain(TRACKER_SECRET);

    await (await fixture.runtime.acquisition.service()).runAddJob(download.id);

    expect(
      fixture.runtime.repositories.downloads.get(download.id),
    ).toMatchObject({
      releaseCandidateId: candidate?.id,
      externalId: INFO_HASH,
      state: "downloading",
    });
    expect(fixture.services.transmissionConflicts).toBe(1);
    expect(
      fixture.services.transmissionCalls.slice(0, 2).map((call) => ({
        method: call.method,
        sessionId: call.sessionId,
      })),
    ).toEqual([
      { method: "session_get", sessionId: null },
      { method: "session_get", sessionId: "test-transmission-session" },
    ]);
    const add = fixture.services.transmissionCalls.find(
      (call) => call.method === "torrent_add",
    );
    expect(add?.params).toMatchObject({
      filename: MAGNET_URI,
      download_dir: `/media/downloads/${download.id}`,
      labels: [`bobarr:${download.id}`],
      paused: false,
    });
  });

  test("never controls or exposes a same-hash torrent without Bobarr ownership", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    const movie = fixture.runtime.repositories.media.create(
      CreateLibraryItemRequestSchema.parse({
        kind: "movie",
        tmdbId: 603,
        title: "The Matrix",
        year: 1999,
        status: "downloading",
        monitorPolicy: "all",
      }),
    );
    const releases = (await (
      await fixture.runtime.app.request(
        "/api/v1/releases?tmdbId=603&kind=movie",
        { headers: { cookie: session.cookie } },
      )
    ).json()) as { items: Array<{ id: string }> };
    const queued = await jsonRequest(
      fixture.runtime,
      "/api/v1/downloads",
      "POST",
      { candidateId: releases.items[0]!.id },
      session,
    );
    const download = (await queued.json()) as { id: string };
    await (await fixture.runtime.acquisition.service()).runAddJob(download.id);
    fixture.services.replaceTorrentOwnership([]);

    const snapshot = await fixture.runtime.app.request("/api/v1/downloads", {
      headers: { cookie: session.cookie },
    });
    expect(snapshot.status).toBe(200);
    expect(
      ((await snapshot.json()) as { downloads: Array<{ progress: number }> })
        .downloads[0]?.progress,
    ).toBe(0);

    const paused = await jsonRequest(
      fixture.runtime,
      `/api/v1/downloads/${download.id}/pause`,
      "POST",
      {},
      session,
    );
    const removed = await jsonRequest(
      fixture.runtime,
      `/api/v1/downloads/${download.id}`,
      "DELETE",
      { deleteData: true },
      session,
    );
    expect(paused.status).toBe(409);
    expect(removed.status).toBe(409);
    expect(fixture.runtime.repositories.media.get(movie.id)).toMatchObject({
      monitorPolicy: "all",
      acquisitionState: "downloading",
    });
    expect(
      fixture.services.transmissionCalls.some((call) =>
        ["torrent_stop", "torrent_remove"].includes(call.method),
      ),
    ).toBe(false);
  });

  test("removing a linked queued download stops monitoring and cancels its jobs", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    const movie = fixture.runtime.repositories.media.create(
      CreateLibraryItemRequestSchema.parse({
        kind: "movie",
        tmdbId: 603,
        title: "The Matrix",
        year: 1999,
        status: "downloading",
        monitorPolicy: "all",
        releaseDate: "1999-03-30T00:00:00.000Z",
      }),
    );
    const mediaJob = await fixture.runtime.queue.enqueue({
      type: "media.acquire.v1",
      payload: { version: 1, mediaId: movie.id },
      dedupeKey: `remove:${movie.id}`,
      maxAttempts: 5,
    });
    const releases = (await (
      await fixture.runtime.app.request(
        "/api/v1/releases?tmdbId=603&kind=movie",
        { headers: { cookie: session.cookie } },
      )
    ).json()) as { items: Array<{ id: string }> };
    const queued = await jsonRequest(
      fixture.runtime,
      "/api/v1/downloads",
      "POST",
      { candidateId: releases.items[0]!.id },
      session,
    );
    const download = (await queued.json()) as {
      id: string;
      mediaId: string | null;
    };
    expect(download.mediaId).toBe(movie.id);

    const response = await jsonRequest(
      fixture.runtime,
      `/api/v1/downloads/${download.id}`,
      "DELETE",
      { deleteData: false },
      session,
    );

    expect(response.status).toBe(200);
    expect(fixture.runtime.repositories.downloads.get(download.id)).toBe(
      undefined,
    );
    expect(fixture.runtime.repositories.media.get(movie.id)).toMatchObject({
      monitorPolicy: "none",
      acquisitionState: "unmonitored",
    });
    expect(await fixture.runtime.queue.get(mediaJob.id)).toMatchObject({
      state: "cancelled",
    });
    const downloadJobs = await fixture.runtime.queue.list({
      types: ["acquisition.add-torrent", "acquisition.organize-download"],
    });
    expect(
      downloadJobs.filter(
        (job) =>
          typeof job.payload === "object" &&
          job.payload !== null &&
          "downloadId" in job.payload &&
          job.payload.downloadId === download.id,
      ),
    ).toEqual([expect.objectContaining({ state: "cancelled" })]);

    await enqueueMissingMedia(
      fixture.runtime.queue,
      fixture.runtime.repositories,
    );
    expect(
      (await fixture.runtime.queue.list({ types: ["media.acquire.v1"] })).some(
        (job) =>
          ["queued", "running"].includes(job.state) &&
          typeof job.payload === "object" &&
          job.payload !== null &&
          "mediaId" in job.payload &&
          job.payload.mediaId === movie.id,
      ),
    ).toBe(false);
    expect(
      fixture.services.transmissionCalls.some((call) =>
        ["torrent_add", "torrent_remove"].includes(call.method),
      ),
    ).toBe(false);
  });

  test("removing a season download stops only that season hierarchy", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    const series = fixture.runtime.repositories.media.create(
      CreateLibraryItemRequestSchema.parse({
        kind: "series",
        tmdbId: 1399,
        title: "Game of Thrones",
        year: 2011,
        status: "downloading",
        monitorPolicy: "selected",
      }),
    );
    const seasonOne = fixture.runtime.repositories.media.create(
      CreateLibraryItemRequestSchema.parse({
        kind: "season",
        tmdbId: 3624,
        parentId: series.id,
        seasonNumber: 1,
        title: "Season 1",
        year: 2011,
        status: "downloading",
        monitorPolicy: "selected",
      }),
    );
    const episode = fixture.runtime.repositories.media.create(
      CreateLibraryItemRequestSchema.parse({
        kind: "episode",
        tmdbId: 63056,
        parentId: seasonOne.id,
        seasonNumber: 1,
        episodeNumber: 1,
        title: "Winter Is Coming",
        year: 2011,
        status: "downloading",
        monitorPolicy: "selected",
      }),
    );
    const seasonTwo = fixture.runtime.repositories.media.create(
      CreateLibraryItemRequestSchema.parse({
        kind: "season",
        tmdbId: 3625,
        parentId: series.id,
        seasonNumber: 2,
        title: "Season 2",
        year: 2012,
        status: "missing",
        monitorPolicy: "selected",
      }),
    );
    const download = fixture.runtime.repositories.downloads.create(
      CreateDownloadInputSchema.parse({
        mediaId: seasonOne.id,
        title: "Game of Thrones S01",
      }),
    );
    const addJob = await fixture.runtime.queue.enqueue({
      type: "acquisition.add-torrent",
      payload: { downloadId: download.id },
      dedupeKey: `add:${download.id}`,
    });
    const organizeJob = await fixture.runtime.queue.enqueue({
      type: "acquisition.organize-download",
      payload: { downloadId: download.id },
      dedupeKey: `organize:${download.id}`,
    });

    const response = await jsonRequest(
      fixture.runtime,
      `/api/v1/downloads/${download.id}`,
      "DELETE",
      { deleteData: false },
      session,
    );

    expect(response.status).toBe(200);
    expect(fixture.runtime.repositories.media.get(seasonOne.id)).toMatchObject({
      monitorPolicy: "none",
      acquisitionState: "unmonitored",
    });
    expect(fixture.runtime.repositories.media.get(episode.id)).toMatchObject({
      monitorPolicy: "none",
      acquisitionState: "unmonitored",
    });
    expect(fixture.runtime.repositories.media.get(seasonTwo.id)).toMatchObject({
      monitorPolicy: "selected",
      acquisitionState: "missing",
    });
    expect(fixture.runtime.repositories.media.get(series.id)).toMatchObject({
      monitorPolicy: "selected",
      acquisitionState: "missing",
    });
    expect(await fixture.runtime.queue.get(addJob.id)).toMatchObject({
      state: "cancelled",
    });
    expect(await fixture.runtime.queue.get(organizeJob.id)).toMatchObject({
      state: "cancelled",
    });
  });

  test("library removal keeps untracked records unless every deletion is explicit", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    const movie = fixture.runtime.repositories.media.create(
      CreateLibraryItemRequestSchema.parse({
        kind: "movie",
        tmdbId: 603,
        title: "The Matrix",
        year: 1999,
        status: "missing",
        monitorPolicy: "all",
      }),
    );

    const response = await jsonRequest(
      fixture.runtime,
      `/api/v1/library/${movie.id}`,
      "DELETE",
      {},
      session,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      deleted: false,
      monitoringStopped: true,
      libraryFilesDeleted: false,
      torrentDeleted: false,
      downloadDataDeleted: false,
    });
    expect(fixture.runtime.repositories.media.get(movie.id)).toMatchObject({
      monitorPolicy: "none",
      acquisitionState: "unmonitored",
    });
  });

  test("fully removing a library hierarchy deletes it from the library view", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    const series = fixture.runtime.repositories.media.create(
      CreateLibraryItemRequestSchema.parse({
        kind: "series",
        tmdbId: 1399,
        title: "Game of Thrones",
        year: 2011,
        status: "missing",
        monitorPolicy: "selected",
      }),
    );
    const season = fixture.runtime.repositories.media.create(
      CreateLibraryItemRequestSchema.parse({
        kind: "season",
        tmdbId: 3624,
        parentId: series.id,
        seasonNumber: 1,
        title: "Season 1",
        year: 2011,
        status: "missing",
        monitorPolicy: "selected",
      }),
    );
    const episode = fixture.runtime.repositories.media.create(
      CreateLibraryItemRequestSchema.parse({
        kind: "episode",
        tmdbId: 63056,
        parentId: season.id,
        seasonNumber: 1,
        episodeNumber: 1,
        title: "Winter Is Coming",
        year: 2011,
        status: "missing",
        monitorPolicy: "selected",
      }),
    );

    const response = await jsonRequest(
      fixture.runtime,
      `/api/v1/library/${series.id}`,
      "DELETE",
      {
        deleteLibraryFiles: true,
        deleteTorrent: true,
        deleteDownloadData: true,
      },
      session,
    );
    const view = await fixture.runtime.app.request(
      "/api/v1/library?limit=100&offset=0",
      { headers: { cookie: session.cookie } },
    );
    const body = (await view.json()) as { items: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      deleted: true,
      monitoringStopped: true,
      libraryFilesDeleted: true,
      torrentDeleted: true,
      downloadDataDeleted: true,
    });
    expect(view.status).toBe(200);
    expect(body.items.map((item) => item.id)).not.toContain(series.id);
    expect(fixture.runtime.repositories.media.get(series.id)).toBeUndefined();
    expect(fixture.runtime.repositories.media.get(season.id)).toBeUndefined();
    expect(fixture.runtime.repositories.media.get(episode.id)).toBeUndefined();
  });

  test("paginates the full durable download history", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);
    for (let index = 0; index < 101; index += 1) {
      fixture.runtime.repositories.downloads.create(
        CreateDownloadInputSchema.parse({ title: `Download ${index}` }),
      );
    }

    const response = await fixture.runtime.app.request(
      "/api/v1/downloads?limit=25&offset=100",
      { headers: { cookie: session.cookie } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      downloads: [{ title: expect.stringContaining("Download") }],
      page: { limit: 25, offset: 100, total: 101 },
    });
  });

  test("requires a session for SSE and streams an initial refresh event", async () => {
    const fixture = await createFixture();
    const session = await setup(fixture.runtime);

    const rejected = await fixture.runtime.app.request("/api/v1/events");
    expect(rejected.status).toBe(401);
    expect(ApiErrorEnvelopeSchema.parse(await rejected.json()).error.code).toBe(
      "unauthorized",
    );

    const abort = new AbortController();
    const accepted = await fixture.runtime.app.request("/api/v1/events", {
      headers: { cookie: session.cookie },
      signal: abort.signal,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("content-type")).toStartWith(
      "text/event-stream",
    );
    const reader = accepted.body?.getReader();
    expect(reader).toBeDefined();
    const first = await reader!.read();
    expect(new TextDecoder().decode(first.value)).toContain(
      "event: snapshot.invalidated",
    );
    await reader!.cancel();
    abort.abort();
    expect(fixture.runtime.events.subscribers).toBe(0);
  });
});

interface Session {
  cookie: string;
  csrfToken: string;
}

interface RpcCall {
  method: string;
  params: Record<string, unknown>;
  sessionId: string | null;
}

class FakeProductServices {
  readonly tmdbRequests: URL[] = [];
  readonly omdbRequests: URL[] = [];
  readonly jackettRequests: URL[] = [];
  readonly transmissionCalls: RpcCall[] = [];
  omdbFails = false;
  transmissionConflicts = 0;
  seriesSeasonCount = 4;
  seriesEpisodeCount = 1;
  seasonAirYear: number | null = null;
  private torrentSnapshot: Record<string, unknown> | null = null;

  replaceTorrentOwnership(labels: readonly string[]): void {
    if (this.torrentSnapshot) {
      this.torrentSnapshot = { ...this.torrentSnapshot, labels: [...labels] };
    }
  }

  readonly fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = requestUrl(input);
    if (url.hostname === "api.themoviedb.org") {
      this.tmdbRequests.push(url);
      return this.tmdb(url);
    }
    if (url.hostname === "www.omdbapi.com") {
      this.omdbRequests.push(url);
      return this.omdb(url);
    }
    if (url.hostname === "jackett.test") {
      this.jackettRequests.push(url);
      return this.jackett(url);
    }
    if (url.hostname === "transmission.test") {
      return this.transmission(init);
    }
    throw new Error(`Unexpected test request: ${url.href}`);
  };

  private tmdb(url: URL): Response {
    if (/^\/3\/discover\/(movie|tv)$/.test(url.pathname)) {
      const mediaType = url.pathname.endsWith("/movie") ? "movie" : "tv";
      return Response.json({
        page: Number(url.searchParams.get("page") ?? 1),
        total_pages: 3,
        total_results: 1,
        results: [
          mediaType === "movie"
            ? {
                id: 603,
                title: "The Matrix",
                original_title: "The Matrix",
                original_language: "en",
                release_date: "1999-03-30",
                vote_average: 8.2,
                vote_count: 25_000,
              }
            : {
                id: 1399,
                name: "Game of Thrones",
                original_name: "Game of Thrones",
                original_language: "en",
                first_air_date: "2011-04-17",
                vote_average: 8.4,
                vote_count: 24_000,
              },
        ],
      });
    }
    if (url.pathname === "/3/configuration/countries") {
      return Response.json([
        {
          iso_3166_1: "FR",
          english_name: "France",
          native_name: "France",
        },
        {
          iso_3166_1: "US",
          english_name: "United States of America",
          native_name: "United States",
        },
      ]);
    }
    if (url.pathname === "/3/search/multi") {
      return Response.json({
        page: 1,
        total_pages: 1,
        total_results: 3,
        results: [
          {
            id: 603,
            media_type: "movie",
            title: "The Matrix",
            original_title: "The Matrix",
            overview: "A hacker discovers the nature of reality.",
            original_language: "en",
            release_date: "1999-03-30",
            poster_path: "/matrix-poster.jpg",
            backdrop_path: "/matrix-backdrop.jpg",
            genre_ids: [28, 878],
            popularity: 100,
            vote_average: 8.2,
            vote_count: 25_000,
          },
          {
            id: 1399,
            media_type: "tv",
            name: "Game of Thrones",
            original_name: "Game of Thrones",
            overview: "Noble families compete for a throne.",
            original_language: "en",
            first_air_date: "2011-04-17",
            poster_path: "/got-poster.jpg",
            backdrop_path: "/got-backdrop.jpg",
            genre_ids: [18],
            popularity: 90,
            vote_average: 8.4,
            vote_count: 24_000,
          },
          { id: 1, media_type: "person", name: "Keanu Reeves" },
        ],
      });
    }
    if (url.pathname === "/3/movie/603") {
      return Response.json({
        id: 603,
        title: "The Matrix",
        original_title: "The Matrix",
        overview: "A hacker discovers the nature of reality.",
        original_language: "en",
        release_date: "1999-03-30",
        poster_path: "/matrix-poster.jpg",
        backdrop_path: "/matrix-backdrop.jpg",
        popularity: 100,
        vote_average: 8.2,
        vote_count: 25_000,
        genres: [
          { id: 28, name: "Action" },
          { id: 878, name: "Science Fiction" },
        ],
        runtime: 136,
        status: "Released",
        tagline: "Welcome to the Real World.",
        imdb_id: "tt0133093",
      });
    }
    if (url.pathname === "/3/movie/603/recommendations") {
      return Response.json({
        page: 1,
        total_pages: 1,
        total_results: 1,
        results: [
          {
            id: 329865,
            title: "Arrival",
            original_title: "Arrival",
            overview: "A linguist works with the military.",
            original_language: "en",
            release_date: "2016-11-11",
            poster_path: "/arrival.jpg",
            backdrop_path: "/arrival-backdrop.jpg",
            genre_ids: [18, 878],
            popularity: 70,
            vote_average: 7.6,
            vote_count: 18_000,
          },
        ],
      });
    }
    if (url.pathname === "/3/tv/1399") {
      return Response.json({
        id: 1399,
        name: "Game of Thrones",
        original_name: "Game of Thrones",
        overview: "Noble families compete for a throne.",
        original_language: "en",
        first_air_date: "2011-04-17",
        poster_path: "/got-poster.jpg",
        backdrop_path: "/got-backdrop.jpg",
        popularity: 90,
        vote_average: 8.4,
        vote_count: 24_000,
        genres: [{ id: 18, name: "Drama" }],
        episode_run_time: [55],
        number_of_seasons: this.seriesSeasonCount,
        number_of_episodes: this.seriesSeasonCount * this.seriesEpisodeCount,
        status: "Returning Series",
        external_ids: { imdb_id: "tt0944947" },
      });
    }
    const seasonMatch = /^\/3\/tv\/1399\/season\/(\d+)$/.exec(url.pathname);
    if (seasonMatch?.[1]) {
      const season = Number(seasonMatch[1]);
      const airYear = this.seasonAirYear ?? 2020 + (season % 10);
      return Response.json({
        id: 5_000 + season,
        name: `Season ${season}`,
        overview: `Season ${season} overview`,
        air_date: `${airYear}-04-01`,
        season_number: season,
        poster_path: `/got-season-${season}.jpg`,
        episodes: Array.from(
          { length: this.seriesEpisodeCount },
          (_, index) => ({
            id: 100_000 + season * 100 + index + 1,
            name: `Episode ${index + 1}`,
            overview: "An episode.",
            air_date: `${airYear}-04-${String(index + 1).padStart(2, "0")}`,
            episode_number: index + 1,
            season_number: season,
            runtime: 55,
            still_path: `/got-s${season}-e${index + 1}.jpg`,
            vote_average: 8,
          }),
        ),
      });
    }
    throw new Error(`Unexpected TMDB request: ${url.href}`);
  }

  private omdb(url: URL): Response {
    if (this.omdbFails) {
      return Response.json(
        { Response: "False", Error: "Temporary provider failure" },
        { status: 503 },
      );
    }
    return Response.json({
      imdbID: url.searchParams.get("i"),
      imdbRating: "8.7",
      imdbVotes: "2,107,348",
      Ratings: [
        { Source: "Internet Movie Database", Value: "8.7/10" },
        { Source: "Rotten Tomatoes", Value: "83%" },
      ],
      Response: "True",
    });
  }

  private jackett(url: URL): Response {
    if (!url.pathname.endsWith("/torznab/api")) {
      throw new Error(`Unexpected Jackett request: ${url.href}`);
    }
    const season = Number(url.searchParams.get("season"));
    const episode = Number(url.searchParams.get("ep"));
    return new Response(
      Number.isSafeInteger(season) && season > 0
        ? torznabFeed(
            `Game.of.Thrones.S${String(season).padStart(2, "0")}${Number.isSafeInteger(episode) && episode > 0 ? `E${String(episode).padStart(2, "0")}` : ""}.1080p.WEB-DL.x265-GRP`,
          )
        : torznabFeed(),
      {
        headers: { "content-type": "application/rss+xml" },
      },
    );
  }

  private transmission(init: RequestInit | undefined): Response {
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: Record<string, unknown>;
    };
    const sessionId = new Headers(init?.headers).get(
      "x-transmission-session-id",
    );
    this.transmissionCalls.push({
      method: request.method,
      params: request.params,
      sessionId,
    });
    if (this.transmissionConflicts === 0) {
      this.transmissionConflicts += 1;
      return new Response(null, {
        status: 409,
        headers: {
          "x-transmission-session-id": "test-transmission-session",
        },
      });
    }
    if (request.method === "torrent_get") {
      return rpcResponse(request.id, {
        torrents: this.torrentSnapshot ? [this.torrentSnapshot] : [],
      });
    }
    if (request.method === "session_get") {
      return rpcResponse(request.id, {
        version: "4.1.3",
        rpc_version_semver: "6.0.0",
      });
    }
    if (request.method === "torrent_add") {
      this.torrentSnapshot = {
        hash_string: INFO_HASH,
        name: "The Matrix",
        status: 4,
        percent_done: 0.92,
        metadata_percent_complete: 1,
        total_size: 100,
        size_when_done: 100,
        left_until_done: 8,
        rate_download: 10,
        rate_upload: 0,
        eta: 1,
        download_dir: request.params["download_dir"],
        labels: request.params["labels"],
        is_finished: false,
        is_stalled: false,
        error: 0,
        files: [{ name: "The.Matrix.1999.mkv", length: 100 }],
        file_stats: [{ bytes_completed: 92, wanted: true, priority: 0 }],
      };
      return rpcResponse(request.id, {
        torrent_added: {
          hash_string: INFO_HASH,
          name: "The Matrix",
        },
      });
    }
    if (request.method === "torrent_remove") {
      this.torrentSnapshot = null;
      return rpcResponse(request.id, {});
    }
    return rpcResponse(request.id, {});
  }
}

async function createFixture(): Promise<{
  runtime: BackendRuntime;
  services: FakeProductServices;
}> {
  const services = new FakeProductServices();
  globalThis.fetch = services.fetch as typeof globalThis.fetch;
  const config: BackendConfig = {
    environment: "test",
    version: "test",
    databasePath: ":memory:",
    encryptionKey: createEncryptionKey(),
    sessionCookieName: "bobarr_session",
    sessionTtlSeconds: 3_600,
    sessionCookieSecure: false,
    loginFailureLimit: 5,
    loginLockSeconds: 60,
  };
  const runtime = await initializeBackend({
    config,
    environment: {
      NODE_ENV: "test",
      TMDB_API_KEY: "tmdb-test-key",
      OMDB_API_KEY: "omdb-test-key",
      BOBARR_JACKETT_API_KEY: "jackett-test-key",
      BOBARR_JACKETT_URL: "http://jackett.test",
      BOBARR_TRANSMISSION_URL: "http://transmission.test/rpc",
    },
  });
  runtimes.push(runtime);
  return { runtime, services };
}

async function setup(runtime: BackendRuntime): Promise<Session> {
  const response = await jsonRequest(runtime, "/api/v1/setup", "POST", {
    username: "admin",
    password: "correct-horse-battery-staple",
  });
  expect(response.status).toBe(201);
  const session = AuthSessionSchema.parse(await response.json());
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) throw new Error("Expected setup session cookie");
  const match = /(?:^|,\s*)bobarr_session=([^;]+)/.exec(setCookie);
  if (match?.[1] === undefined)
    throw new Error("Missing Bobarr session cookie");
  return {
    cookie: `bobarr_session=${match[1]}`,
    csrfToken: session.csrfToken,
  };
}

function jsonRequest(
  runtime: BackendRuntime,
  path: string,
  method: string,
  body: unknown,
  session?: Session,
): Promise<Response> {
  return Promise.resolve(
    runtime.app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(session === undefined
          ? {}
          : {
              cookie: session.cookie,
              "x-csrf-token": session.csrfToken,
            }),
      },
      body: JSON.stringify(body),
    }),
  );
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

function torznabFeed(title = "The.Matrix.1999.1080p.WEB-DL.x265-GRP"): string {
  return `<?xml version="1.0"?>
    <rss xmlns:torznab="http://torznab.com/schemas/2015/feed">
      <channel>
        <torznab:response offset="0" total="1" />
        <item>
          <title>${title}</title>
          <guid>matrix-release</guid>
          <link><![CDATA[${MAGNET_URI}]]></link>
          <pubDate>Tue, 21 Jul 2026 10:00:00 GMT</pubDate>
          <torznab:attr name="magneturl" value="${escapeXml(MAGNET_URI)}" />
          <torznab:attr name="infohash" value="${INFO_HASH}" />
          <torznab:attr name="size" value="3000000000" />
          <torznab:attr name="seeders" value="42" />
          <torznab:attr name="peers" value="7" />
          <torznab:attr name="category" value="2000" />
          <torznab:attr name="indexer" value="Fake Indexer" />
        </item>
      </channel>
    </rss>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function rpcResponse(id: number, result: Record<string, unknown>): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}
