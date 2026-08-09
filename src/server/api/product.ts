import type { Download, LibraryItem, MediaKind } from "../../contracts";
import type { ReleaseProfile, ReleaseTarget } from "../domain/releases";
import type {
  CatalogDetails,
  CatalogItem as TmdbCatalogItem,
  OmdbRatings,
  TmdbClient,
} from "../integrations";
import type { ApiDependencies, ApiEnvironment } from "./app";
import type { IntegrationKey } from "./integration-resolver";
import type { Context } from "hono";

import { access, stat } from "node:fs/promises";

import { z, type OpenAPIHono } from "@hono/zod-openapi";

import { withLiveDownloadProgress } from "./live-download-progress";
import {
  MAX_MULTIPART_OVERHEAD_BYTES,
  MAX_TORRENT_UPLOAD_BYTES,
} from "./request-body-limit";
import {
  ActivityListSchema,
  ApiErrorEnvelopeSchema,
  DownloadSchema,
  DownloadsQuerySchema,
  DownloadsListSchema,
  IntegrationStatusSchema,
  LibraryItemSchema,
  OpaqueReleaseIdSchema,
  PaginationQuerySchema,
  ReleaseCandidateSchema,
} from "../../contracts";
import {
  ADD_TORRENT_JOB,
  CandidateUnavailableError,
  InvalidAcquisitionSourceError,
  ORGANIZE_DOWNLOAD_JOB,
  downloadRepositoryFromDatabase,
  isOwnedTorrent,
  type AcquisitionService,
  type CandidateSearchResult,
  type DownloadRecord,
  type TorrentEngine,
  type TorrentSnapshot,
} from "../application";
import { AppError, notFound } from "../core";
import { aggregateChildAcquisitionState } from "../domain/media-state";
import {
  deleteRecordedFile,
  resolveRecordedFileForRead,
  UnsafeLibraryDeletionError,
} from "../library";

const CatalogKindSchema = z.enum(["movie", "series"]);
const LibraryFileParamsSchema = z.object({
  id: z.string().min(1),
  fileId: z.string().min(1),
});
const LibraryDownloadFileSchema = z.object({
  id: z.string().min(1),
  mediaId: z.string().min(1),
  name: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  downloadUrl: z.string().min(1),
});
const MAX_RECOMMENDATION_CURSOR = 1_000_000;
const CatalogRatingsSchema = z
  .object({
    imdb: z
      .object({
        value: z.number().min(0).max(10),
        scale: z.literal(10),
        votes: z.number().int().nonnegative().nullable(),
      })
      .nullable(),
    rottenTomatoes: z
      .object({
        value: z.number().min(0).max(100),
        scale: z.literal(100),
      })
      .nullable(),
  })
  .openapi("CatalogRatings");
const CatalogActorSchema = z.object({
  tmdbId: z.number().int().positive(),
  name: z.string().min(1),
  character: z.string().nullable(),
  profilePath: z.string().nullable(),
});
const CatalogItemSchema = z.object({
  id: z.string(),
  tmdbId: z.number().int().positive(),
  kind: CatalogKindSchema,
  title: z.string(),
  originalTitle: z.string(),
  overview: z.string(),
  posterPath: z.string().nullable(),
  backdropPath: z.string().nullable(),
  releaseDate: z.string().nullable(),
  year: z.number().int().nullable(),
  voteAverage: z.number(),
  genres: z
    .array(z.object({ id: z.number().int(), name: z.string() }))
    .optional(),
  actors: z.array(CatalogActorSchema).max(6).optional(),
  numberOfSeasons: z.number().int().nonnegative().nullable().optional(),
  monitoredSeasonNumbers: z.array(z.number().int().positive()).optional(),
  ratings: CatalogRatingsSchema.optional(),
  monitored: z.boolean(),
  acquisitionState: z.string().optional(),
});
const CatalogPageSchema = z.object({
  items: z.array(CatalogItemSchema),
  page: z.number().int().positive(),
  totalPages: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  personalized: z.boolean().optional(),
});
const CatalogRecommendationSourceSchema = z.object({
  id: z.string(),
  tmdbId: z.number().int().positive(),
  kind: CatalogKindSchema,
  title: z.string(),
  year: z.number().int().nullable(),
  posterUrl: z.string().nullable(),
});
const CatalogRecommendationGroupSchema = z.object({
  source: CatalogRecommendationSourceSchema,
  items: z.array(CatalogItemSchema),
});
const CatalogRecommendationsResponseSchema = z.object({
  groups: z.array(CatalogRecommendationGroupSchema),
  items: z.array(CatalogItemSchema),
  page: z.literal(1),
  totalPages: z.literal(1),
  personalized: z.boolean(),
  totalItems: z.number().int().nonnegative(),
  sourceTotal: z.number().int().nonnegative(),
  nextCursor: z.number().int().nonnegative().nullable(),
});
const CatalogRecommendationsQuerySchema = z.object({
  cursor: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_RECOMMENDATION_CURSOR)
    .default(0),
});
const CatalogSearchQuerySchema = z.object({
  query: z.string().trim().min(1).max(300),
  kind: CatalogKindSchema.optional(),
  year: z.coerce.number().int().min(1870).max(3000).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});
const CatalogDiscoverSortSchema = z.enum([
  "popularity.asc",
  "popularity.desc",
  "vote_average.asc",
  "vote_average.desc",
  "vote_count.asc",
  "vote_count.desc",
  "release_date.asc",
  "release_date.desc",
  "primary_release_date.asc",
  "primary_release_date.desc",
  "first_air_date.asc",
  "first_air_date.desc",
  "title.asc",
  "title.desc",
  "name.asc",
  "name.desc",
  "original_title.asc",
  "original_title.desc",
  "original_name.asc",
  "original_name.desc",
  "revenue.asc",
  "revenue.desc",
]);
const CatalogDiscoverDateSchema = z.iso.date().refine(
  (value) => {
    const year = Number(value.slice(0, 4));
    return year >= 1874 && year <= 2200;
  },
  { message: "Date year must be from 1874 to 2200" },
);
const CatalogDiscoverGenresSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => {
    const genres = value.split(",");
    return (
      genres.length <= 20 &&
      genres.every((genre) => /^[1-9]\d{0,5}$/.test(genre))
    );
  }, "Use up to 20 comma-separated positive genre ids");
const CatalogDiscoverQuerySchema = z
  .object({
    kind: CatalogKindSchema.default("movie"),
    sort: CatalogDiscoverSortSchema.default("popularity.desc"),
    page: z.coerce.number().int().min(1).max(500).default(1),
    genres: CatalogDiscoverGenresSchema.optional(),
    actorId: z.coerce.number().int().positive().optional(),
    originCountry: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/i, "Use an ISO 3166-1 alpha-2 country code")
      .optional(),
    originalLanguage: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/i, "Use an ISO 639-1 language code")
      .optional(),
    year: z.coerce.number().int().min(1874).max(2200).optional(),
    dateFrom: CatalogDiscoverDateSchema.optional(),
    dateTo: CatalogDiscoverDateSchema.optional(),
    runtimeMin: z.coerce.number().int().min(0).max(1_440).optional(),
    runtimeMax: z.coerce.number().int().min(0).max(1_440).optional(),
    voteCountMin: z
      .preprocess(
        (value) =>
          typeof value === "string" && value.trim() === "" ? Number.NaN : value,
        z.coerce.number().int().min(0).max(100_000_000),
      )
      .optional(),
    ratingMin: z.coerce.number().min(0).max(10).optional(),
  })
  .superRefine((value, context) => {
    if (
      value.runtimeMin !== undefined &&
      value.runtimeMax !== undefined &&
      value.runtimeMin > value.runtimeMax
    ) {
      context.addIssue({
        code: "custom",
        path: ["runtimeMax"],
        message: "runtimeMax must be greater than or equal to runtimeMin",
      });
    }
    if (
      value.dateFrom !== undefined &&
      value.dateTo !== undefined &&
      value.dateFrom > value.dateTo
    ) {
      context.addIssue({
        code: "custom",
        path: ["dateTo"],
        message: "dateTo must be on or after dateFrom",
      });
    }
    if (
      value.year !== undefined &&
      (value.dateFrom !== undefined || value.dateTo !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["year"],
        message: "Use either year or a date range, not both",
      });
    }
    if (value.kind === "series" && value.sort.startsWith("revenue.")) {
      context.addIssue({
        code: "custom",
        path: ["sort"],
        message: "Revenue sorting is available only for movies",
      });
    }
    if (value.kind === "series" && value.actorId !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["actorId"],
        message: "Actor discovery is available only for movies",
      });
    }
  });
const CatalogPopularQuerySchema = z.object({
  kind: CatalogKindSchema.default("movie"),
  page: z.coerce.number().int().min(1).max(500).default(1),
});
const CatalogGenresQuerySchema = z.object({
  kind: CatalogKindSchema.default("movie"),
});
const CatalogDetailsParamsSchema = z.object({
  kind: CatalogKindSchema,
  tmdbId: z.coerce.number().int().positive(),
});
const CatalogSeasonParamsSchema = z.object({
  tmdbId: z.coerce.number().int().positive(),
  seasonNumber: z.coerce.number().int().nonnegative(),
});
const MonitorMediaSchema = z
  .object({
    tmdbId: z.number().int().positive(),
    kind: CatalogKindSchema,
    monitorPolicy: z.enum(["none", "selected", "all", "future"]).default("all"),
    acquisitionMode: z.enum(["automatic", "manual"]).optional(),
    seasonNumbers: z.array(z.number().int().positive()).max(100).optional(),
    includeFutureSeasons: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.kind === "movie" &&
      (value.seasonNumbers !== undefined ||
        value.includeFutureSeasons !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["seasonNumbers"],
        message: "Season monitoring is available only for series",
      });
    }
    if (value.kind === "series" && value.acquisitionMode !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["acquisitionMode"],
        message: "Manual acquisition mode is available only for movies",
      });
    }
    if (
      value.kind === "series" &&
      value.monitorPolicy === "selected" &&
      value.seasonNumbers?.length === 0 &&
      value.includeFutureSeasons !== true
    ) {
      context.addIssue({
        code: "custom",
        path: ["seasonNumbers"],
        message: "Choose a current season or monitor future seasons",
      });
    }
  });
const MonitorPatchSchema = z
  .object({
    monitorPolicy: z.enum(["none", "selected", "all", "future"]),
    seasonNumbers: z.array(z.number().int().positive()).max(100).optional(),
    includeFutureSeasons: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (
      value.monitorPolicy === "selected" &&
      value.seasonNumbers?.length === 0 &&
      value.includeFutureSeasons !== true
    ) {
      context.addIssue({
        code: "custom",
        path: ["seasonNumbers"],
        message: "Choose a current season or monitor future seasons",
      });
    }
  });
const ReplaceLibrarySchema = z
  .object({ candidateId: OpaqueReleaseIdSchema.optional() })
  .strict();
const LibraryRemovalSchema = z.object({
  deleteLibraryRecord: z.boolean().default(false),
  deleteLibraryFiles: z.boolean().default(false),
  deleteTorrent: z.boolean().default(false),
  deleteDownloadData: z.boolean().default(false),
});
const ReleaseSearchQuerySchema = z.object({
  tmdbId: z.coerce.number().int().positive(),
  kind: CatalogKindSchema,
  season: z.coerce.number().int().positive().optional(),
  episode: z.coerce.number().int().positive().optional(),
  query: z.string().trim().min(1).max(300).optional(),
});
const ReleaseListSchema = z.object({
  items: z.array(
    ReleaseCandidateSchema.extend({
      size: z.number().int().nonnegative(),
      scoreExplanation: z.array(
        z.object({ label: z.string(), value: z.number() }),
      ),
    }),
  ),
  expiresAt: z.string().datetime({ offset: true }),
  query: z.string().min(1),
  mediaId: z.string().uuid().nullable(),
  replacementRequired: z.boolean(),
});
const DownloadCreateSchema = z
  .object({
    candidateId: z.string().optional(),
    magnet: z.string().max(16_384).optional(),
    paused: z.boolean().optional(),
    peerLimit: z.number().int().positive().max(10_000).optional(),
  })
  .refine((value) => Boolean(value.candidateId) !== Boolean(value.magnet), {
    message: "Provide exactly one candidateId or magnet",
  });
const DownloadParamsSchema = z.object({ id: z.string().uuid() });
const DownloadFilesSchema = z.object({
  wanted: z.array(z.number().int().nonnegative()).optional(),
  unwanted: z.array(z.number().int().nonnegative()).optional(),
  priorityHigh: z.array(z.number().int().nonnegative()).optional(),
  priorityNormal: z.array(z.number().int().nonnegative()).optional(),
  priorityLow: z.array(z.number().int().nonnegative()).optional(),
});
const DeleteDownloadSchema = z.object({
  deleteData: z.boolean().default(false),
});
const IntegrationParamsSchema = z.object({
  key: z.enum(["tmdb", "jackett", "transmission", "omdb"]),
});
const StorageValidationSchema = z.object({
  downloadsPath: z.string().min(1).max(4096),
  moviesPath: z.string().min(1).max(4096),
  televisionPath: z.string().min(1).max(4096),
  organizationStrategy: z.enum(["hardlink", "symlink", "copy", "move"]),
});

const json = (schema: z.ZodType, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const productErrors = {
  default: json(ApiErrorEnvelopeSchema, "Standard API error"),
};

export function registerProductRoutes(
  app: OpenAPIHono<ApiEnvironment>,
  dependencies: ApiDependencies,
): void {
  registerProductDocumentation(app);

  app.get("/api/v1/catalog/search", async (context) => {
    const query = parse(CatalogSearchQuerySchema, context.req.query());
    const settings =
      dependencies.repositories.settings.ensureDefaults().settings;
    const client = await requireIntegrations(dependencies).tmdb();
    const result = await cachedTmdb(
      dependencies,
      "movie",
      cacheId("search", query),
      localeKey(settings),
      10 * 60_000,
      () =>
        integrationCall("tmdb", () =>
          client.search(query.query, {
            page: query.page,
            mediaType: query.kind ? toTmdbKind(query.kind) : undefined,
            year: query.year,
            language: settings.locale.language,
            region: settings.locale.region,
          }),
        ),
    );
    const filtered = query.kind
      ? result.results.filter(
          (item) => toCatalogKind(item.mediaType) === query.kind,
        )
      : result.results;
    return context.json({
      items: filtered.map((item) => catalogItem(item, dependencies)),
      page: result.page,
      totalPages: result.totalPages,
      totalItems: result.totalResults,
    });
  });

  app.get("/api/v1/catalog/discover", async (context) => {
    const query = parse(CatalogDiscoverQuerySchema, context.req.query());
    const settings =
      dependencies.repositories.settings.ensureDefaults().settings;
    const client = await requireIntegrations(dependencies).tmdb();
    const result = await cachedTmdb(
      dependencies,
      query.kind,
      cacheId("discover", query),
      localeKey(settings),
      15 * 60_000,
      () =>
        integrationCall("tmdb", () =>
          client.discover(toTmdbKind(query.kind), {
            page: query.page,
            language: settings.locale.language,
            region: settings.locale.region,
            sortBy: query.sort,
            ...(query.genres === undefined
              ? {}
              : {
                  genres: query.genres.split(",").map((genre) => Number(genre)),
                  genreMode: "any",
                }),
            ...(query.actorId === undefined ? {} : { castId: query.actorId }),
            ...(query.originCountry === undefined
              ? {}
              : { originCountry: query.originCountry }),
            ...(query.originalLanguage === undefined
              ? {}
              : { originalLanguage: query.originalLanguage }),
            ...(query.year === undefined ? {} : { year: query.year }),
            ...(query.dateFrom === undefined
              ? {}
              : { dateFrom: query.dateFrom }),
            ...(query.dateTo === undefined ? {} : { dateTo: query.dateTo }),
            ...(query.runtimeMin === undefined
              ? {}
              : { minimumRuntimeMinutes: query.runtimeMin }),
            ...(query.runtimeMax === undefined
              ? {}
              : { maximumRuntimeMinutes: query.runtimeMax }),
            ...(query.voteCountMin === undefined
              ? {}
              : { minimumVoteCount: query.voteCountMin }),
            ...(query.ratingMin === undefined
              ? {}
              : { minimumVoteAverage: query.ratingMin }),
            signal: context.req.raw.signal,
          }),
        ),
    );
    return context.json(catalogPage(result, dependencies));
  });

  app.get("/api/v1/catalog/popular", async (context) => {
    const query = parse(CatalogPopularQuerySchema, context.req.query());
    const settings =
      dependencies.repositories.settings.ensureDefaults().settings;
    const client = await requireIntegrations(dependencies).tmdb();
    const result = await cachedTmdb(
      dependencies,
      query.kind,
      cacheId("popular", query),
      localeKey(settings),
      15 * 60_000,
      () =>
        integrationCall("tmdb", () =>
          client.popular(toTmdbKind(query.kind), {
            page: query.page,
            language: settings.locale.language,
            region: settings.locale.region,
            signal: context.req.raw.signal,
          }),
        ),
    );
    return context.json(catalogPage(result, dependencies));
  });

  app.get("/api/v1/catalog/genres", async (context) => {
    const query = parse(CatalogGenresQuerySchema, context.req.query());
    const settings =
      dependencies.repositories.settings.ensureDefaults().settings;
    const client = await requireIntegrations(dependencies).tmdb();
    const result = await cachedTmdb(
      dependencies,
      query.kind,
      `genres:${query.kind}`,
      localeKey(settings),
      7 * 24 * 60 * 60_000,
      async () => ({
        items: await integrationCall("tmdb", () =>
          client.genres(toTmdbKind(query.kind), {
            language: settings.locale.language,
            signal: context.req.raw.signal,
          }),
        ),
      }),
    );
    return context.json(result);
  });

  app.get("/api/v1/catalog/languages", async (context) => {
    const client = await requireIntegrations(dependencies).tmdb();
    const result = await cachedTmdb(
      dependencies,
      "movie",
      "configuration:languages",
      "all",
      7 * 24 * 60 * 60_000,
      async () => ({
        items: await integrationCall("tmdb", () =>
          client.languages(context.req.raw.signal),
        ),
      }),
    );
    return context.json(result);
  });

  app.get("/api/v1/catalog/countries", async (context) => {
    const settings =
      dependencies.repositories.settings.ensureDefaults().settings;
    const client = await requireIntegrations(dependencies).tmdb();
    const result = await cachedTmdb(
      dependencies,
      "movie",
      "configuration:countries",
      localeKey(settings),
      7 * 24 * 60 * 60_000,
      async () => ({
        items: await integrationCall("tmdb", () =>
          client.countries({
            language: settings.locale.language,
            signal: context.req.raw.signal,
          }),
        ),
      }),
    );
    return context.json(result);
  });

  app.get("/api/v1/catalog/recommendations", async (context) => {
    const query = parse(CatalogRecommendationsQuerySchema, context.req.query());
    const settings =
      dependencies.repositories.settings.ensureDefaults().settings;
    const client = await requireIntegrations(dependencies).tmdb();
    const sourceLimit = 3;
    const itemLimit = 20;
    const options = {
      page: 1,
      language: settings.locale.language,
      region: settings.locale.region,
      signal: context.req.raw.signal,
    };
    const movieSources = dependencies.repositories.media.recommendationSources({
      kind: "movie",
      limit: sourceLimit,
      cursor: query.cursor,
    });
    const seriesSources = dependencies.repositories.media.recommendationSources(
      {
        kind: "series",
        limit: sourceLimit,
        cursor: query.cursor,
      },
    );
    const sources = [...movieSources.items, ...seriesSources.items].sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id),
    );
    const recommendationPages = await Promise.all(
      sources.map(async (source) => {
        try {
          const page = await cachedTmdb(
            dependencies,
            source.kind,
            `recommendations:${source.tmdbId}`,
            localeKey(settings),
            15 * 60_000,
            () =>
              integrationCall("tmdb", () =>
                client.recommendations(
                  toTmdbKind(source.kind as "movie" | "series"),
                  source.tmdbId!,
                  options,
                ),
              ),
          );
          return { source, items: page.results, error: undefined };
        } catch (error) {
          if (context.req.raw.signal.aborted) throw error;
          return {
            source,
            items: [] as readonly TmdbCatalogItem[],
            error,
          };
        }
      }),
    );
    const failedPages = recommendationPages.filter(
      (page) => page.error !== undefined,
    );
    if (
      recommendationPages.length > 0 &&
      failedPages.length === recommendationPages.length
    ) {
      throw failedPages[0]!.error;
    }
    const emitted = new Set<string>();
    const positions = recommendationPages.map(() => 0);
    const groups = recommendationPages.map(({ source }) => ({
      source: {
        id: source.id,
        tmdbId: source.tmdbId!,
        kind: source.kind as "movie" | "series",
        title: source.title,
        year: source.year,
        posterUrl: source.posterUrl,
      },
      items: [] as ReturnType<typeof catalogItem>[],
    }));

    let addedInPass = true;
    while (addedInPass) {
      addedInPass = false;
      for (const [index, page] of recommendationPages.entries()) {
        const group = groups[index]!;
        if (group.items.length >= itemLimit) continue;
        while ((positions[index] ?? 0) < page.items.length) {
          const position = positions[index] ?? 0;
          const item = page.items[position]!;
          positions[index] = position + 1;
          const key = `${item.mediaType}:${item.tmdbId}`;
          if (
            emitted.has(key) ||
            dependencies.repositories.media.getByTmdb(
              toCatalogKind(item.mediaType),
              item.tmdbId,
            )
          ) {
            continue;
          }
          emitted.add(key);
          group.items.push(
            catalogItem(item, dependencies, { knownLibraryItem: null }),
          );
          addedInPass = true;
          break;
        }
      }
    }

    const populatedGroups = groups.filter((group) => group.items.length > 0);
    const items = populatedGroups.flatMap((group) => group.items);
    const hasMoreSources =
      movieSources.total > movieSources.items.length ||
      seriesSources.total > seriesSources.items.length;
    return context.json({
      groups: populatedGroups,
      items,
      page: 1 as const,
      totalPages: 1 as const,
      personalized: populatedGroups.length > 0,
      totalItems: items.length,
      sourceTotal: movieSources.total + seriesSources.total,
      nextCursor: hasMoreSources
        ? (query.cursor + sourceLimit) % (MAX_RECOMMENDATION_CURSOR + 1)
        : null,
    });
  });

  app.get("/api/v1/catalog/:kind/:tmdbId", async (context) => {
    const params = parse(CatalogDetailsParamsSchema, context.req.param());
    const settings =
      dependencies.repositories.settings.ensureDefaults().settings;
    const client = await requireIntegrations(dependencies).tmdb();
    const details = await cachedTmdb(
      dependencies,
      params.kind,
      catalogDetailsCacheId(params.tmdbId),
      localeKey(settings),
      24 * 60 * 60_000,
      () =>
        integrationCall("tmdb", () =>
          client.details(toTmdbKind(params.kind), params.tmdbId, {
            language: settings.locale.language,
            signal: context.req.raw.signal,
          }),
        ),
    );
    const ratings = await optionalOmdbRatings(
      dependencies,
      params.kind,
      details.externalId,
      context.req.raw.signal,
    );
    return context.json(catalogDetails(details, dependencies, ratings));
  });

  app.get(
    "/api/v1/catalog/series/:tmdbId/seasons/:seasonNumber",
    async (context) => {
      const params = parse(CatalogSeasonParamsSchema, context.req.param());
      const settings =
        dependencies.repositories.settings.ensureDefaults().settings;
      const client = await requireIntegrations(dependencies).tmdb();
      return context.json(
        await cachedTmdb(
          dependencies,
          "season",
          `season:${params.tmdbId}:${params.seasonNumber}`,
          localeKey(settings),
          6 * 60 * 60_000,
          () =>
            integrationCall("tmdb", () =>
              client.season(params.tmdbId, params.seasonNumber, {
                language: settings.locale.language,
                signal: context.req.raw.signal,
              }),
            ),
        ),
      );
    },
  );

  app.post("/api/v1/library", async (context) => {
    const input = parse(MonitorMediaSchema, await context.req.json());
    const existing = dependencies.repositories.media.getByTmdb(
      input.kind,
      input.tmdbId,
    );
    const settings =
      dependencies.repositories.settings.ensureDefaults().settings;
    const client = await requireIntegrations(dependencies).tmdb();
    const details = await cachedTmdb(
      dependencies,
      input.kind,
      catalogDetailsCacheId(input.tmdbId),
      localeKey(settings),
      24 * 60 * 60_000,
      () =>
        integrationCall("tmdb", () =>
          client.details(toTmdbKind(input.kind), input.tmdbId, {
            language: settings.locale.language,
            signal: context.req.raw.signal,
          }),
        ),
    );
    if (existing) {
      const updated = await updateExistingMonitoring({
        parent: existing,
        input,
        details,
        dependencies,
        client,
        language: settings.locale.language,
        signal: context.req.raw.signal,
      });
      return context.json(libraryView(updated), 200);
    }
    const parent = dependencies.repositories.media.create({
      kind: input.kind,
      tmdbId: input.tmdbId,
      parentId: null,
      seasonNumber: null,
      episodeNumber: null,
      title: details.title,
      year: details.year,
      posterUrl: tmdbImage(details.posterPath, "w500"),
      status: input.monitorPolicy === "none" ? "unmonitored" : "missing",
      monitorPolicy: input.monitorPolicy,
      releaseDate: isoDate(details.releaseDate),
      metadata: {
        ...metadataFor(
          details,
          input.monitorPolicy === "future" ||
            input.includeFutureSeasons === true,
        ),
        ...(input.kind === "movie"
          ? { manualSearchPending: input.acquisitionMode === "manual" }
          : {}),
      },
    });
    const targets =
      input.kind === "series"
        ? await createMonitoredSeasons(
            parent,
            details,
            input,
            dependencies,
            client,
            settings.locale.language,
            context.req.raw.signal,
          )
        : [parent];
    if (input.kind === "movie" && parent.releaseDate) {
      dependencies.repositories.calendar.create({
        title: parent.title,
        kind: "release",
        scheduledAt: parent.releaseDate,
        libraryItemId: parent.id,
        status: "scheduled",
        metadata: {
          mediaKind: "movie",
          posterUrl: parent.posterUrl,
          acquisitionState: parent.acquisitionState,
        },
      });
    }
    if (input.acquisitionMode !== "manual") {
      for (const target of targets) {
        if (target.kind === "season") {
          await enqueueSeasonAcquisition(target, dependencies);
        } else {
          await enqueueAcquisition(target, dependencies);
        }
      }
    }
    recordActivity(
      dependencies,
      "library.added",
      "success",
      input.acquisitionMode === "manual"
        ? `${parent.title} was added for manual release selection`
        : `${parent.title} is now monitored`,
      parent.id,
    );
    dependencies.events?.publish("library.changed", { id: parent.id });
    return context.json(libraryView(parent), 201);
  });

  app.patch("/api/v1/library/:id", async (context) => {
    const id = parse(DownloadParamsSchema, context.req.param()).id;
    const input = parse(MonitorPatchSchema, await context.req.json());
    const current = dependencies.repositories.media.get(id);
    if (!current) throw notFound("Library item not found");
    if (current.kind === "movie") {
      if (
        input.seasonNumbers !== undefined ||
        input.includeFutureSeasons !== undefined
      ) {
        throw badRequest("Season monitoring is available only for series");
      }
      const updated = await updateExistingMonitoring({
        parent: current,
        input,
        dependencies,
      });
      return context.json(libraryView(updated));
    }
    if (current.kind === "series") {
      if (current.tmdbId === null) {
        throw conflictError(
          "This series needs a confirmed TMDB match before seasons can be changed",
        );
      }
      const settings =
        dependencies.repositories.settings.ensureDefaults().settings;
      const client = await requireIntegrations(dependencies).tmdb();
      const details = await cachedTmdb(
        dependencies,
        "series",
        catalogDetailsCacheId(current.tmdbId),
        localeKey(settings),
        24 * 60 * 60_000,
        () =>
          integrationCall("tmdb", () =>
            client.details("tv", current.tmdbId!, {
              language: settings.locale.language,
              signal: context.req.raw.signal,
            }),
          ),
      );
      const updated = await updateExistingMonitoring({
        parent: current,
        input,
        details,
        dependencies,
        client,
        language: settings.locale.language,
        signal: context.req.raw.signal,
      });
      return context.json(libraryView(updated));
    }
    const tree = mediaTree(current, dependencies);
    for (const member of tree) {
      let policy = input.monitorPolicy;
      if (member.id !== current.id) {
        policy = input.monitorPolicy === "none" ? "none" : "selected";
      }
      dependencies.repositories.media.updateMonitorPolicy(member.id, policy);
      if (input.monitorPolicy === "none") {
        dependencies.repositories.media.updateState(
          member.id,
          stateAfterMonitoringStops(member, dependencies),
        );
      } else if (member.acquisitionState === "unmonitored") {
        dependencies.repositories.media.updateState(member.id, "missing");
      }
    }
    if (input.monitorPolicy === "none") {
      await cancelAcquisitionJobs(
        tree.map((item) => item.id),
        dependencies,
      );
    }
    const item = dependencies.repositories.media.get(id);
    if (!item) throw notFound("Library item not found");
    dependencies.events?.publish("library.changed", { id });
    return context.json(libraryView(item));
  });

  app.post("/api/v1/library/:id/retry", async (context) => {
    const id = parse(DownloadParamsSchema, context.req.param()).id;
    const item = dependencies.repositories.media.get(id);
    if (!item) throw notFound("Library item not found");
    if (item.monitorPolicy === "none") {
      throw conflictError("Resume monitoring before retrying this title");
    }
    const targets =
      item.kind === "series"
        ? dependencies.repositories.media
            .children(item.id)
            .filter(
              (child) =>
                child.kind === "season" && child.monitorPolicy !== "none",
            )
        : [item];
    const jobs = [];
    for (const target of targets) {
      dependencies.repositories.media.updateState(target.id, "searching");
      const job = await enqueueAcquisition(target, dependencies, true);
      if (job) jobs.push(job);
    }
    dependencies.repositories.media.updateState(id, "searching");
    recordActivity(
      dependencies,
      "acquisition.retry",
      "info",
      `Searching again for ${item.title}`,
      id,
    );
    dependencies.events?.publish("library.changed", { id });
    return context.json(
      {
        accepted: true,
        jobId: jobs[0]?.id ?? null,
        jobIds: jobs.map((job) => job.id),
      },
      202,
    );
  });

  app.post("/api/v1/library/:id/replace", async (context) => {
    const id = parse(DownloadParamsSchema, context.req.param()).id;
    const input = parse(
      ReplaceLibrarySchema,
      await context.req.json().catch(() => ({})),
    );
    const item = dependencies.repositories.media.get(id);
    if (!item) throw notFound("Library item not found");
    if (item.monitorPolicy === "none" && !input.candidateId) {
      throw conflictError(
        "Choose a release for a one-time replacement, or resume monitoring for an automatic replacement",
      );
    }
    const targets =
      item.kind === "series"
        ? dependencies.repositories.media
            .children(item.id)
            .filter(
              (child) =>
                child.kind === "season" && child.monitorPolicy !== "none",
            )
        : [item];
    if (targets.length === 0) {
      throw conflictError("This title has no monitored releases to replace");
    }
    let downloadId: string | null = null;
    const jobIds: string[] = [];
    if (input.candidateId) {
      if (targets.length !== 1) {
        throw badRequest(
          "Select a movie, season, or episode when replacing from a candidate",
        );
      }
      const candidate = dependencies.repositories.releases.get(
        input.candidateId,
      );
      if (!candidate) {
        throw conflictError("Release candidate has expired");
      }
      if (candidate.mediaId !== targets[0]!.id) {
        throw conflictError(
          "Release candidate does not belong to this library item",
        );
      }
      const target = targets[0]!;
      const activeDownloads = activeReplacementDownloads(
        target.id,
        dependencies,
      );
      if (
        !hasRecordedFiles(target, dependencies) &&
        activeDownloads.length === 0
      ) {
        throw conflictError(
          "Replacement requires an active Bobarr download or an existing organized file",
        );
      }
      await verifyReplacementOwnership(activeDownloads, dependencies);
      const download = await acquisitionCall(() =>
        requireAcquisition(dependencies).then((service) =>
          service.startFromCandidate(input.candidateId!),
        ),
      );
      downloadId = download.id;
      try {
        await cancelAcquisitionJobs([target.id], dependencies);
        const supersededDownloads = activeReplacementDownloads(
          target.id,
          dependencies,
        ).filter((active) => active.id !== download.id);
        await verifyReplacementOwnership(supersededDownloads, dependencies);
        await retireSupersededDownloads(
          supersededDownloads.map((active) => active.id),
          dependencies,
        );
      } catch (error) {
        await retireSupersededDownloads([download.id], dependencies).catch(
          () => undefined,
        );
        throw error;
      }
      markReplacementPending(target, dependencies);
      dependencies.repositories.media.updateState(target.id, "queued");
      dependencies.events?.publish("download.changed", { id: download.id });
    } else {
      if (targets.some((target) => !hasRecordedFiles(target, dependencies))) {
        throw conflictError(
          "Replacement requires an existing organized file; use retry for missing media",
        );
      }
      for (const target of targets) {
        markReplacementPending(target, dependencies);
        dependencies.repositories.media.updateState(target.id, "searching");
        const job = await enqueueAcquisition(target, dependencies, true);
        if (job) jobIds.push(job.id);
      }
    }
    dependencies.repositories.media.updateState(
      item.id,
      downloadId ? "queued" : "searching",
    );
    recordActivity(
      dependencies,
      "acquisition.replacement-requested",
      "info",
      `Replacement requested for ${item.title}`,
      item.id,
    );
    dependencies.events?.publish("library.changed", { id: item.id });
    return context.json({ accepted: true, downloadId, jobIds }, 202);
  });

  app.get("/api/v1/library/:id/files", async (context) => {
    const id = parse(DownloadParamsSchema, context.req.param()).id;
    const item = dependencies.repositories.media.get(id);
    if (!item) throw notFound("Library item not found");
    const settings =
      dependencies.repositories.settings.ensureDefaults().settings.storage;
    const libraryRoots = [settings.moviesPath, settings.televisionPath];
    const readableRoots = [...libraryRoots, settings.downloadsPath];
    const files = [];
    for (const member of mediaTree(item, dependencies)) {
      for (const file of dependencies.repositories.libraryFiles.listForMedia(
        member.id,
      )) {
        const readable = await resolveRecordedFileForRead(
          file.path,
          libraryRoots,
          readableRoots,
        );
        if (!readable) continue;
        files.push({
          id: file.id,
          mediaId: file.mediaId,
          name: readable.name,
          sizeBytes: readable.sizeBytes,
          downloadUrl: `/api/v1/library/${encodeURIComponent(id)}/files/${encodeURIComponent(file.id)}/download`,
        });
      }
    }
    return context.json({ files });
  });

  app.get("/api/v1/library/:id/files/:fileId/download", async (context) => {
    const { id, fileId } = parse(LibraryFileParamsSchema, context.req.param());
    const item = dependencies.repositories.media.get(id);
    if (!item) throw notFound("Library item not found");
    const mediaIds = new Set(
      mediaTree(item, dependencies).map((member) => member.id),
    );
    const file = dependencies.repositories.libraryFiles.get(fileId);
    if (!file || !mediaIds.has(file.mediaId)) {
      throw notFound("Library file not found");
    }
    const settings =
      dependencies.repositories.settings.ensureDefaults().settings.storage;
    const libraryRoots = [settings.moviesPath, settings.televisionPath];
    const readable = await resolveRecordedFileForRead(file.path, libraryRoots, [
      ...libraryRoots,
      settings.downloadsPath,
    ]);
    if (!readable) throw notFound("Library file not found on disk");
    return new Response(Bun.file(readable.path), {
      headers: {
        "Content-Disposition": contentDisposition(readable.name),
        "Content-Length": String(readable.sizeBytes),
        "Content-Type":
          Bun.file(readable.path).type || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  app.post("/api/v1/library/scan", async (context) => {
    const body = parse(
      z.object({ kind: CatalogKindSchema.optional() }),
      await context.req.json().catch(() => ({})),
    );
    const settings =
      dependencies.repositories.settings.ensureDefaults().settings;
    const roots = libraryScanRoots(body.kind, settings.storage);
    const job = await requireQueue(dependencies).enqueue({
      type: "library.scan.v1",
      payload: {
        version: 1,
        kind: body.kind ?? null,
        roots,
      },
      dedupeKey: `scan:${body.kind ?? "all"}`,
      maxAttempts: 3,
    });
    dependencies.events?.publish("job.changed", { id: job.id });
    return context.json({ accepted: true, jobId: job.id }, 202);
  });

  app.delete("/api/v1/library/:id", async (context) => {
    const id = parse(DownloadParamsSchema, context.req.param()).id;
    const input = parse(
      LibraryRemovalSchema,
      await context.req.json().catch(() => ({})),
    );
    if (input.deleteDownloadData && !input.deleteTorrent) {
      throw badRequest("deleteDownloadData requires deleteTorrent");
    }
    const item = dependencies.repositories.media.get(id);
    if (!item) throw notFound("Library item not found");
    const deleteLibraryRecord =
      input.deleteLibraryRecord ||
      (input.deleteLibraryFiles &&
        input.deleteTorrent &&
        input.deleteDownloadData);
    if (
      deleteLibraryRecord &&
      !input.deleteTorrent &&
      mediaTree(item, dependencies).some(
        (member) =>
          dependencies.repositories.downloads.list({
            limit: 1,
            offset: 0,
            mediaId: member.id,
          }).downloads.length > 0,
      )
    ) {
      throw conflictError(
        "Remove linked torrents before deleting this library record",
      );
    }
    const tree = await stopMediaAutomation(item, dependencies);
    const mediaIds = tree.map((member) => member.id);
    if (input.deleteLibraryFiles) {
      for (const mediaId of mediaIds) {
        await deleteRecordedLibraryFiles(mediaId, dependencies);
      }
      for (const mediaId of mediaIds) {
        const remaining = dependencies.repositories.media.get(mediaId);
        if (!remaining) continue;
        dependencies.repositories.media.updateState(
          remaining.id,
          hasRecordedFiles(remaining, dependencies)
            ? "available"
            : "unmonitored",
        );
      }
    }
    if (input.deleteTorrent)
      for (const mediaId of mediaIds) {
        await removeMediaTorrents(
          mediaId,
          input.deleteDownloadData,
          dependencies,
        );
      }
    if (deleteLibraryRecord) {
      dependencies.repositories.calendar.deleteForLibraryItems(mediaIds);
      if (!dependencies.repositories.media.delete(item.id)) {
        throw internalError("Library item could not be deleted");
      }
      recomputeAncestorAcquisitionStates(item.parentId, dependencies);
    }
    recordActivity(
      dependencies,
      deleteLibraryRecord ? "library.removed" : "library.unmonitored",
      "warning",
      deleteLibraryRecord
        ? `Removed ${item.title} from the library`
        : `Stopped monitoring ${item.title}`,
      id,
    );
    dependencies.events?.publish("library.changed", { id });
    return context.json({
      deleted: deleteLibraryRecord,
      monitoringStopped: true,
      libraryFilesDeleted: input.deleteLibraryFiles,
      torrentDeleted: input.deleteTorrent,
      downloadDataDeleted: input.deleteDownloadData,
    });
  });

  app.get("/api/v1/releases", async (context) => {
    const query = parse(ReleaseSearchQuerySchema, context.req.query());
    const release = await resolveReleaseContext(
      query,
      dependencies,
      context.req.raw.signal,
    );
    const result = await acquisitionSearch(
      dependencies,
      release.target,
      query.tmdbId,
      release.mediaId ?? undefined,
      query.query,
      context.req.raw.signal,
    );
    const replacementRequired = release.mediaId
      ? isExplicitReplacementTarget(release.mediaId, dependencies)
      : false;
    return context.json(
      releaseResult(
        result,
        query.kind,
        query.tmdbId,
        release.mediaId,
        replacementRequired,
      ),
    );
  });

  app.get("/api/v1/downloads", async (context) => {
    const query = parse(DownloadsQuerySchema, context.req.query());
    const result = dependencies.repositories.downloads.list(query);
    const downloads = await withLiveDownloadProgress(
      result.downloads,
      dependencies,
      context.req.raw.signal,
    );
    return context.json({
      downloads,
      items: downloads,
      page: { limit: query.limit, offset: query.offset, total: result.total },
    });
  });

  app.post("/api/v1/downloads", async (context) => {
    const service = await requireAcquisition(dependencies);
    const contentType = context.req.header("content-type") ?? "";
    let download;
    let candidateTarget: LibraryItem | undefined;
    let replacementTarget: LibraryItem | undefined;
    if (contentType.includes("multipart/form-data")) {
      const contentLength = Number(context.req.header("content-length"));
      if (!Number.isSafeInteger(contentLength) || contentLength < 1) {
        throw badRequest(
          "Torrent uploads require a valid Content-Length header",
        );
      }
      if (
        contentLength >
        MAX_TORRENT_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
      ) {
        throw badRequest("Torrent metainfo exceeds the 10 MiB limit");
      }
      const form = await context.req.formData();
      const torrent = form.get("torrent");
      if (!(torrent instanceof File))
        throw badRequest("A torrent metainfo file is required");
      if (torrent.size > MAX_TORRENT_UPLOAD_BYTES)
        throw badRequest("Torrent metainfo exceeds the 10 MiB limit");
      const metainfo = new Uint8Array(await torrent.arrayBuffer());
      download = await acquisitionCall(() =>
        service.startFromMetainfo({
          target: {
            kind: "movie",
            title: torrent.name.replace(/\.torrent$/i, "") || "Manual download",
          },
          title: torrent.name,
          metainfo,
        }),
      );
    } else {
      const input = parse(DownloadCreateSchema, await context.req.json());
      const manualTitle = input.magnet
        ? magnetDisplayName(input.magnet)
        : "Manual download";
      if (input.candidateId) {
        const mediaId = dependencies.repositories.releases.get(
          input.candidateId,
        )?.mediaId;
        const media = mediaId
          ? dependencies.repositories.media.get(mediaId)
          : undefined;
        candidateTarget = media;
        if (media && hasRecordedFiles(media, dependencies)) {
          replacementTarget = media;
        }
      }
      download = input.candidateId
        ? await acquisitionCall(() =>
            service.startFromCandidate(input.candidateId!, input),
          )
        : await acquisitionCall(() =>
            service.startFromMagnet({
              target: { kind: "movie", title: manualTitle },
              title: manualTitle,
              magnetUri: input.magnet!,
              paused: input.paused,
              peerLimit: input.peerLimit,
            }),
          );
    }
    if (
      candidateTarget &&
      (candidateTarget.metadata["manualSearchPending"] === true ||
        replacementTarget)
    ) {
      if (replacementTarget)
        markReplacementPending(replacementTarget, dependencies);
      dependencies.repositories.media.updateMetadata(candidateTarget.id, {
        metadata: {
          ...candidateTarget.metadata,
          manualSearchPending: false,
        },
      });
      dependencies.repositories.media.updateState(candidateTarget.id, "queued");
      dependencies.events?.publish("library.changed", {
        id: candidateTarget.id,
      });
    }
    recordActivity(
      dependencies,
      "download.queued",
      "info",
      `${download.title} was queued`,
      download.id,
    );
    dependencies.events?.publish("download.changed", { id: download.id });
    const publicDownload = dependencies.repositories.downloads.get(download.id);
    if (!publicDownload)
      throw internalError("Queued download was not persisted");
    return context.json(publicDownload, 202);
  });

  app.post("/api/v1/downloads/:id/pause", async (context) => {
    return controlDownload(context, dependencies, "pause");
  });
  app.post("/api/v1/downloads/:id/resume", async (context) => {
    return controlDownload(context, dependencies, "resume");
  });
  app.post("/api/v1/downloads/:id/retry", async (context) => {
    const id = parse(DownloadParamsSchema, context.req.param()).id;
    const download = await acquisitionCall(() =>
      requireAcquisition(dependencies).then((service) =>
        service.retryDownload(id),
      ),
    );
    dependencies.events?.publish("download.changed", { id });
    const publicDownload = dependencies.repositories.downloads.get(download.id);
    if (!publicDownload)
      throw internalError("Retried download was not persisted");
    return context.json(publicDownload, 202);
  });
  app.patch("/api/v1/downloads/:id/files", async (context) => {
    const id = parse(DownloadParamsSchema, context.req.param()).id;
    const input = parse(DownloadFilesSchema, await context.req.json());
    const download = dependencies.repositories.downloads.get(id);
    if (!download) throw notFound("Download not found");
    if (!download.externalId)
      throw conflictError("Download has not been submitted to Transmission");
    const owned = await requireOwnedTorrent(
      download,
      dependencies,
      context.req.raw.signal,
    );
    await integrationCall("transmission", () =>
      owned.transmission.selectFiles(
        owned.torrent.hash,
        input,
        context.req.raw.signal,
      ),
    );
    return context.json({ updated: true });
  });
  app.delete("/api/v1/downloads/:id", async (context) => {
    const id = parse(DownloadParamsSchema, context.req.param()).id;
    const input = parse(
      DeleteDownloadSchema,
      await context.req.json().catch(() => ({})),
    );
    const download = dependencies.repositories.downloads.get(id);
    if (!download) throw notFound("Download not found");
    const owned = download.externalId
      ? await findOwnedTorrentForRemoval(
          download,
          dependencies,
          context.req.raw.signal,
        )
      : null;
    if (download.mediaId) {
      const media = dependencies.repositories.media.get(download.mediaId);
      if (media) await stopMediaAutomation(media, dependencies);
    }
    await cancelDownloadJobs([download.id], dependencies);
    if (owned) {
      await integrationCall("transmission", () =>
        owned.transmission.remove(
          owned.torrent.hash,
          input.deleteData,
          context.req.raw.signal,
        ),
      );
    }
    const durableDownloads = downloadRepositoryFromDatabase(
      dependencies.database,
    );
    const durable = await durableDownloads.findById(id);
    if (durable) {
      await durableDownloads.transition(id, [durable.state], {
        state: "removed",
        error: "Removed by administrator",
        updatedAt: Date.now(),
      });
    } else {
      dependencies.repositories.downloads.update(id, {
        state: "failed",
        error: "Removed by administrator",
      });
    }
    recordActivity(
      dependencies,
      "download.removed",
      "warning",
      `${download.title} was removed`,
      id,
    );
    dependencies.events?.publish("download.changed", { id });
    return context.json({
      removed: true,
      dataDeleted: owned !== null && input.deleteData,
    });
  });

  app.get("/api/v1/events", (context) => {
    if (!dependencies.events)
      throw unavailable("Event streaming is unavailable");
    return new Response(dependencies.events.stream(context.req.raw.signal), {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });

  app.get("/api/v1/system/activity", (context) => {
    const query = parse(PaginationQuerySchema, context.req.query());
    const result = dependencies.repositories.activity.list(query);
    return context.json({
      events: result.events,
      items: result.events,
      page: { ...query, total: result.total },
    });
  });

  app.post("/api/v1/system/backups", async (context) => {
    if (!dependencies.backup) throw unavailable("Backups are unavailable");
    const result = await dependencies.backup();
    recordActivity(
      dependencies,
      "backup.completed",
      "success",
      "SQLite backup completed",
      null,
    );
    return context.json({ completed: true, result }, 201);
  });

  app.post("/api/v1/settings/integrations/:key/test", async (context) => {
    const { key } = parse(IntegrationParamsSchema, context.req.param());
    const status = await requireIntegrations(dependencies).test(key);
    dependencies.events?.publish("service.changed", {
      reason: "connection-tested",
      integrations: [key],
      status,
    });
    return context.json(status);
  });

  app.post("/api/v1/settings/storage/validate", async (context) => {
    const input = parse(StorageValidationSchema, await context.req.json());
    return context.json(await validateStorage(input));
  });
}

function registerProductDocumentation(app: OpenAPIHono<ApiEnvironment>): void {
  const secured = [{ sessionCookie: [] }];
  const register = (
    config: Parameters<typeof app.openAPIRegistry.registerPath>[0],
  ) => app.openAPIRegistry.registerPath(config);
  register({
    method: "get",
    path: "/api/v1/catalog/search",
    tags: ["catalog"],
    security: secured,
    request: { query: CatalogSearchQuerySchema },
    responses: {
      200: json(CatalogPageSchema, "Catalog search results"),
      ...productErrors,
    },
  });
  register({
    method: "get",
    path: "/api/v1/catalog/discover",
    tags: ["catalog"],
    security: secured,
    request: { query: CatalogDiscoverQuerySchema },
    responses: {
      200: json(CatalogPageSchema, "Catalog discovery results"),
      ...productErrors,
    },
  });
  register({
    method: "get",
    path: "/api/v1/catalog/popular",
    tags: ["catalog"],
    security: secured,
    request: { query: CatalogPopularQuerySchema },
    responses: {
      200: json(CatalogPageSchema, "Popular catalog titles"),
      ...productErrors,
    },
  });
  register({
    method: "get",
    path: "/api/v1/catalog/genres",
    tags: ["catalog"],
    security: secured,
    request: { query: CatalogGenresQuerySchema },
    responses: {
      200: json(
        z.object({
          items: z.array(
            z.object({ id: z.number().int().positive(), name: z.string() }),
          ),
        }),
        "TMDB genres",
      ),
      ...productErrors,
    },
  });
  register({
    method: "get",
    path: "/api/v1/catalog/languages",
    tags: ["catalog"],
    security: secured,
    responses: {
      200: json(
        z.object({
          items: z.array(
            z.object({
              code: z.string(),
              englishName: z.string(),
              name: z.string(),
            }),
          ),
        }),
        "TMDB languages",
      ),
      ...productErrors,
    },
  });
  register({
    method: "get",
    path: "/api/v1/catalog/countries",
    tags: ["catalog"],
    security: secured,
    responses: {
      200: json(
        z.object({
          items: z.array(
            z.object({
              code: z.string().length(2),
              englishName: z.string(),
              nativeName: z.string(),
            }),
          ),
        }),
        "TMDB countries",
      ),
      ...productErrors,
    },
  });
  register({
    method: "get",
    path: "/api/v1/catalog/recommendations",
    tags: ["catalog"],
    security: secured,
    request: { query: CatalogRecommendationsQuerySchema },
    responses: {
      200: json(
        CatalogRecommendationsResponseSchema,
        "Library-based catalog recommendations grouped by source title",
      ),
      ...productErrors,
    },
  });
  register({
    method: "get",
    path: "/api/v1/catalog/{kind}/{tmdbId}",
    tags: ["catalog"],
    security: secured,
    request: { params: CatalogDetailsParamsSchema },
    responses: {
      200: json(CatalogItemSchema, "Catalog details"),
      ...productErrors,
    },
  });
  register({
    method: "get",
    path: "/api/v1/catalog/series/{tmdbId}/seasons/{seasonNumber}",
    tags: ["catalog"],
    security: secured,
    request: { params: CatalogSeasonParamsSchema },
    responses: {
      200: json(z.record(z.string(), z.unknown()), "TV season details"),
      ...productErrors,
    },
  });
  register({
    method: "post",
    path: "/api/v1/library",
    tags: ["library"],
    security: secured,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: MonitorMediaSchema } },
      },
    },
    responses: {
      200: json(LibraryItemSchema, "Updated existing monitored media"),
      201: json(LibraryItemSchema, "Monitored media"),
      ...productErrors,
    },
  });
  register({
    method: "get",
    path: "/api/v1/library/{id}/files",
    tags: ["library"],
    security: secured,
    request: { params: DownloadParamsSchema },
    responses: {
      200: json(
        z.object({ files: z.array(LibraryDownloadFileSchema) }),
        "Recorded files currently available for direct download",
      ),
      ...productErrors,
    },
  });
  register({
    method: "get",
    path: "/api/v1/library/{id}/files/{fileId}/download",
    tags: ["library"],
    security: secured,
    request: { params: LibraryFileParamsSchema },
    responses: {
      200: {
        description: "Recorded library file",
        content: {
          "application/octet-stream": {
            schema: z.string().openapi({ format: "binary" }),
          },
        },
      },
      ...productErrors,
    },
  });
  register({
    method: "get",
    path: "/api/v1/releases",
    tags: ["releases"],
    security: secured,
    request: { query: ReleaseSearchQuerySchema },
    responses: {
      200: json(ReleaseListSchema, "Ranked release candidates"),
      ...productErrors,
    },
  });
  register({
    method: "patch",
    path: "/api/v1/library/{id}",
    tags: ["library"],
    security: secured,
    request: {
      params: DownloadParamsSchema,
      body: {
        required: true,
        content: { "application/json": { schema: MonitorPatchSchema } },
      },
    },
    responses: {
      200: json(LibraryItemSchema, "Updated monitoring policy"),
      ...productErrors,
    },
  });
  register({
    method: "post",
    path: "/api/v1/library/{id}/retry",
    tags: ["library"],
    security: secured,
    request: { params: DownloadParamsSchema },
    responses: {
      202: json(
        z.object({
          accepted: z.boolean(),
          jobId: z.string().uuid().nullable(),
        }),
        "Retry accepted",
      ),
      ...productErrors,
    },
  });
  register({
    method: "post",
    path: "/api/v1/library/{id}/replace",
    tags: ["library"],
    security: secured,
    request: {
      params: DownloadParamsSchema,
      body: {
        required: false,
        content: { "application/json": { schema: ReplaceLibrarySchema } },
      },
    },
    responses: {
      202: json(
        z.object({
          accepted: z.boolean(),
          downloadId: z.string().uuid().nullable(),
          jobIds: z.array(z.string().uuid()),
        }),
        "Replacement acquisition accepted",
      ),
      ...productErrors,
    },
  });
  register({
    method: "post",
    path: "/api/v1/library/scan",
    tags: ["library"],
    security: secured,
    responses: {
      202: json(
        z.object({ accepted: z.boolean(), jobId: z.string().uuid() }),
        "Scan accepted",
      ),
      ...productErrors,
    },
  });
  register({
    method: "delete",
    path: "/api/v1/library/{id}",
    tags: ["library"],
    security: secured,
    request: {
      params: DownloadParamsSchema,
      body: {
        required: false,
        content: { "application/json": { schema: LibraryRemovalSchema } },
      },
    },
    responses: {
      200: json(
        z.object({
          deleted: z.boolean(),
          monitoringStopped: z.boolean(),
          libraryFilesDeleted: z.boolean(),
          torrentDeleted: z.boolean(),
          downloadDataDeleted: z.boolean(),
        }),
        "Explicit removal result",
      ),
      ...productErrors,
    },
  });
  register({
    method: "get",
    path: "/api/v1/downloads",
    tags: ["downloads"],
    security: secured,
    request: { query: DownloadsQuerySchema },
    responses: {
      200: json(DownloadsListSchema, "Downloads"),
      ...productErrors,
    },
  });
  register({
    method: "post",
    path: "/api/v1/downloads",
    tags: ["downloads"],
    security: secured,
    request: {
      body: {
        required: true,
        content: {
          "application/json": { schema: DownloadCreateSchema },
          "multipart/form-data": { schema: z.object({ torrent: z.any() }) },
        },
      },
    },
    responses: {
      202: json(DownloadSchema, "Queued download"),
      ...productErrors,
    },
  });
  register({
    method: "get",
    path: "/api/v1/events",
    tags: ["events"],
    security: secured,
    responses: {
      200: {
        description: "Authenticated server-sent event stream",
        content: { "text/event-stream": { schema: z.string() } },
      },
      ...productErrors,
    },
  });
  for (const action of ["pause", "resume", "retry"] as const) {
    register({
      method: "post",
      path: `/api/v1/downloads/{id}/${action}`,
      tags: ["downloads"],
      security: secured,
      request: { params: DownloadParamsSchema },
      responses: {
        200: json(DownloadSchema, `${action} download`),
        202: json(DownloadSchema, `${action} download`),
        ...productErrors,
      },
    });
  }
  register({
    method: "patch",
    path: "/api/v1/downloads/{id}/files",
    tags: ["downloads"],
    security: secured,
    request: {
      params: DownloadParamsSchema,
      body: {
        required: true,
        content: { "application/json": { schema: DownloadFilesSchema } },
      },
    },
    responses: {
      200: json(z.object({ updated: z.boolean() }), "File selection updated"),
      ...productErrors,
    },
  });
  register({
    method: "delete",
    path: "/api/v1/downloads/{id}",
    tags: ["downloads"],
    security: secured,
    request: {
      params: DownloadParamsSchema,
      body: {
        required: false,
        content: { "application/json": { schema: DeleteDownloadSchema } },
      },
    },
    responses: {
      200: json(
        z.object({ removed: z.boolean(), dataDeleted: z.boolean() }),
        "Download removed",
      ),
      ...productErrors,
    },
  });
  register({
    method: "get",
    path: "/api/v1/system/activity",
    tags: ["system"],
    security: secured,
    request: { query: PaginationQuerySchema },
    responses: {
      200: json(ActivityListSchema, "Activity events"),
      ...productErrors,
    },
  });
  register({
    method: "post",
    path: "/api/v1/settings/integrations/{key}/test",
    tags: ["settings"],
    security: secured,
    request: { params: IntegrationParamsSchema },
    responses: {
      200: json(IntegrationStatusSchema, "Integration status"),
      ...productErrors,
    },
  });
  register({
    method: "post",
    path: "/api/v1/settings/storage/validate",
    tags: ["settings"],
    security: secured,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: StorageValidationSchema } },
      },
    },
    responses: {
      200: json(
        z.object({ valid: z.boolean(), message: z.string() }),
        "Storage validation result",
      ),
      ...productErrors,
    },
  });
  register({
    method: "post",
    path: "/api/v1/system/backups",
    tags: ["system"],
    security: secured,
    responses: {
      201: json(
        z.object({ completed: z.boolean(), result: z.unknown() }),
        "Verified SQLite backup",
      ),
      ...productErrors,
    },
  });
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new AppError({
    code: "validation_failed",
    message: "Request validation failed",
    status: 422,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  });
}

function catalogPage(
  page: {
    page: number;
    totalPages: number;
    totalResults: number;
    results: readonly TmdbCatalogItem[];
  },
  dependencies: ApiDependencies,
) {
  return {
    items: page.results.map((item) => catalogItem(item, dependencies)),
    page: page.page,
    totalPages: page.totalPages,
    totalItems: page.totalResults,
  };
}

async function cachedTmdb<T extends object>(
  dependencies: ApiDependencies,
  kind: MediaKind,
  externalId: string,
  locale: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  return cachedMetadata(
    dependencies,
    "tmdb",
    kind,
    externalId,
    locale,
    ttlMs,
    load,
  );
}

async function cachedMetadata<T extends object>(
  dependencies: ApiDependencies,
  provider: string,
  kind: MediaKind,
  externalId: string,
  locale: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const cached = dependencies.repositories.metadataCache.get({
    provider,
    kind,
    externalId,
    locale,
  });
  if (cached) return cached.value as T;
  const value = await load();
  const now = new Date();
  dependencies.repositories.metadataCache.upsert({
    provider,
    kind,
    externalId,
    locale,
    value: value as Record<string, unknown>,
    etag: null,
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  });
  return value;
}

async function optionalOmdbRatings(
  dependencies: ApiDependencies,
  kind: "movie" | "series",
  imdbId: string | null,
  signal?: AbortSignal,
): Promise<OmdbRatings | undefined> {
  if (!imdbId) return undefined;
  try {
    const client = await requireIntegrations(dependencies).omdb();
    const ratings = await cachedMetadata(
      dependencies,
      "omdb",
      kind,
      imdbId,
      "global",
      7 * 24 * 60 * 60_000,
      () => client.ratings(imdbId, signal),
    );
    return ratings.imdb || ratings.rottenTomatoes ? ratings : undefined;
  } catch {
    return undefined;
  }
}

function cacheId(namespace: string, value: unknown): string {
  const digest = new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
  return `${namespace}:${digest}`;
}

function catalogDetailsCacheId(tmdbId: number): string {
  return `details:v3:${tmdbId}`;
}

function localeKey(settings: {
  locale: { language: string; region: string };
}): string {
  return `${settings.locale.language}-${settings.locale.region}`;
}

function catalogItem(
  item: TmdbCatalogItem,
  dependencies: ApiDependencies,
  options?: { knownLibraryItem: LibraryItem | null },
) {
  const kind = toCatalogKind(item.mediaType);
  const monitored =
    options === undefined
      ? dependencies.repositories.media.getByTmdb(kind, item.tmdbId)
      : (options.knownLibraryItem ?? undefined);
  return {
    id: `${kind}:${item.tmdbId}`,
    tmdbId: item.tmdbId,
    kind,
    title: item.title,
    originalTitle: item.originalTitle,
    overview: item.overview,
    posterPath: item.posterPath,
    backdropPath: item.backdropPath,
    releaseDate: item.releaseDate,
    year: item.year,
    voteAverage: item.voteAverage,
    monitored: monitored !== undefined,
    ...(monitored ? { acquisitionState: monitored.acquisitionState } : {}),
  };
}

function catalogDetails(
  details: CatalogDetails,
  dependencies: ApiDependencies,
  ratings?: OmdbRatings,
) {
  const kind = toCatalogKind(details.mediaType);
  const monitored = dependencies.repositories.media.getByTmdb(
    kind,
    details.tmdbId,
  );
  const monitoredSeasonNumbers =
    monitored?.kind === "series"
      ? dependencies.repositories.media
          .children(monitored.id)
          .filter(
            (item): item is LibraryItem & { seasonNumber: number } =>
              item.kind === "season" &&
              item.seasonNumber !== null &&
              item.monitorPolicy !== "none",
          )
          .map((item) => item.seasonNumber)
      : [];
  return {
    ...catalogItem(details, dependencies),
    genres: [...details.genres],
    ...(details.mediaType === "movie"
      ? { actors: details.actors.slice(0, 6) }
      : {}),
    ...(details.trailer ? { trailer: details.trailer } : {}),
    numberOfSeasons: details.numberOfSeasons,
    monitoredSeasonNumbers,
    ...(ratings
      ? {
          ratings: {
            imdb: ratings.imdb,
            rottenTomatoes: ratings.rottenTomatoes,
          },
        }
      : {}),
  };
}

function toCatalogKind(kind: "movie" | "tv"): "movie" | "series" {
  return kind === "tv" ? "series" : "movie";
}

function toTmdbKind(kind: "movie" | "series"): "movie" | "tv" {
  return kind === "series" ? "tv" : "movie";
}

function tmdbImage(
  path: string | null,
  size: "w500" | "original",
): string | null {
  return path
    ? `https://image.tmdb.org/t/p/${size}/${path.replace(/^\//, "")}`
    : null;
}

function isoDate(value: string | null): string | null {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

function metadataFor(
  details: CatalogDetails,
  includeFutureSeasons?: boolean,
  futureSeasonsAfter?: number,
) {
  return {
    overview: details.overview,
    originalTitle: details.originalTitle,
    backdropPath: details.backdropPath,
    genres: details.genres,
    voteAverage: details.voteAverage,
    voteCount: details.voteCount,
    numberOfSeasons: details.numberOfSeasons,
    numberOfEpisodes: details.numberOfEpisodes,
    includeFutureSeasons: includeFutureSeasons ?? false,
    ...(includeFutureSeasons
      ? {
          futureSeasonsAfter:
            futureSeasonsAfter ?? details.numberOfSeasons ?? 0,
        }
      : {}),
  };
}

type MonitoringInput = Pick<
  z.infer<typeof MonitorMediaSchema>,
  "monitorPolicy" | "acquisitionMode" | "seasonNumbers" | "includeFutureSeasons"
>;

type SeasonAcquisitionMode = "season" | "episodes";

export function seasonUsesEpisodeAcquisition(item: LibraryItem): boolean {
  return (
    item.kind === "season" && item.metadata["acquisitionMode"] === "episodes"
  );
}

function seasonAcquisitionMode(
  season: Awaited<ReturnType<TmdbClient["season"]>> | null,
  existing: LibraryItem | undefined,
  now = Date.now(),
): SeasonAcquisitionMode {
  const episodes = season?.episodes ?? [];
  const incomplete =
    episodes.length === 0 ||
    episodes.some((episode) => {
      if (!episode.airDate) return true;
      const releaseAt = Date.parse(`${episode.airDate}T00:00:00.000Z`);
      return !Number.isFinite(releaseAt) || releaseAt > now;
    });
  if (incomplete || existing?.metadata["acquisitionMode"] === "episodes") {
    return "episodes";
  }
  return "season";
}

async function updateExistingMonitoring(options: {
  parent: LibraryItem;
  input: MonitoringInput;
  dependencies: ApiDependencies;
  details?: CatalogDetails;
  client?: TmdbClient;
  language?: string;
  signal?: AbortSignal;
}): Promise<LibraryItem> {
  const { parent, input, dependencies, details, client, language, signal } =
    options;
  const includeFutureSeasons =
    input.includeFutureSeasons ?? input.monitorPolicy === "future";
  const manualSearchPending =
    parent.kind === "movie" && input.acquisitionMode === "manual";
  const existingFutureBaseline = parent.metadata["futureSeasonsAfter"];
  const futureSeasonsAfter =
    includeFutureSeasons &&
    parent.metadata["includeFutureSeasons"] === true &&
    typeof existingFutureBaseline === "number" &&
    Number.isSafeInteger(existingFutureBaseline) &&
    existingFutureBaseline >= 0
      ? existingFutureBaseline
      : (details?.numberOfSeasons ?? 0);
  dependencies.repositories.media.updateMonitorPolicy(
    parent.id,
    input.monitorPolicy,
  );
  if (details) {
    dependencies.repositories.media.updateMetadata(parent.id, {
      title: details.title,
      year: details.year,
      posterUrl: tmdbImage(details.posterPath, "w500"),
      releaseDate: isoDate(details.releaseDate),
      metadata: {
        ...parent.metadata,
        ...metadataFor(details, includeFutureSeasons, futureSeasonsAfter),
        ...(parent.kind === "movie" ? { manualSearchPending } : {}),
      },
    });
  } else if (parent.kind === "series") {
    dependencies.repositories.media.updateMetadata(parent.id, {
      metadata: {
        ...parent.metadata,
        includeFutureSeasons,
        ...(includeFutureSeasons ? { futureSeasonsAfter } : {}),
      },
    });
  }

  if (input.monitorPolicy === "none") {
    const tree = mediaTree(parent, dependencies);
    for (const member of tree) {
      dependencies.repositories.media.updateMonitorPolicy(member.id, "none");
      dependencies.repositories.media.updateState(
        member.id,
        stateAfterMonitoringStops(member, dependencies),
      );
    }
    await cancelAcquisitionJobs(
      tree.map((member) => member.id),
      dependencies,
    );
    dependencies.events?.publish("library.changed", { id: parent.id });
    return dependencies.repositories.media.get(parent.id) ?? parent;
  }

  if (parent.kind === "movie") {
    let updated = dependencies.repositories.media.get(parent.id) ?? parent;
    if (updated.acquisitionState === "unmonitored") {
      updated =
        dependencies.repositories.media.updateState(
          updated.id,
          hasRecordedFiles(updated, dependencies) ? "available" : "missing",
        ) ?? updated;
    }
    if (
      !manualSearchPending &&
      ["missing", "failed"].includes(updated.acquisitionState)
    ) {
      await enqueueAcquisition(updated, dependencies);
    }
    recordActivity(
      dependencies,
      "library.monitoring-updated",
      "success",
      `Updated monitoring for ${updated.title}`,
      updated.id,
    );
    dependencies.events?.publish("library.changed", { id: updated.id });
    return updated;
  }

  if (parent.kind !== "series" || !details || !client || !language) {
    throw conflictError("Series monitoring requires current TMDB metadata");
  }
  const selectedNumbers = selectedSeasonNumbers(details, input);
  const selectedSet = new Set(selectedNumbers);
  const existingSeasons = dependencies.repositories.media
    .children(parent.id)
    .filter(
      (item): item is LibraryItem & { seasonNumber: number } =>
        item.kind === "season" && item.seasonNumber !== null,
    );
  const unselected = existingSeasons.filter(
    (season) => !selectedSet.has(season.seasonNumber),
  );
  for (const season of unselected) {
    for (const member of mediaTree(season, dependencies)) {
      dependencies.repositories.media.updateMonitorPolicy(member.id, "none");
      dependencies.repositories.media.updateState(
        member.id,
        stateAfterMonitoringStops(member, dependencies),
      );
    }
  }
  await cancelAcquisitionJobs(
    unselected.flatMap((season) =>
      mediaTree(season, dependencies).map((member) => member.id),
    ),
    dependencies,
  );

  await ensureMonitoredSeasons({
    parent,
    seasonNumbers: selectedNumbers,
    dependencies,
    client,
    language,
    signal,
  });
  const selectedSeasons = dependencies.repositories.media
    .children(parent.id)
    .filter(
      (item): item is LibraryItem & { seasonNumber: number } =>
        item.kind === "season" &&
        item.seasonNumber !== null &&
        selectedSet.has(item.seasonNumber),
    );
  for (const season of selectedSeasons) {
    const seasonTree = mediaTree(season, dependencies);
    for (const member of seasonTree) {
      dependencies.repositories.media.updateMonitorPolicy(
        member.id,
        "selected",
      );
      if (member.acquisitionState === "unmonitored") {
        dependencies.repositories.media.updateState(
          member.id,
          hasRecordedFiles(member, dependencies) ? "available" : "missing",
        );
      }
    }
    let refreshed = dependencies.repositories.media.get(season.id) ?? season;
    const episodes = dependencies.repositories.media
      .children(season.id)
      .filter((child) => child.kind === "episode");
    if (
      episodes.length > 0 &&
      ["available", "unmonitored"].includes(refreshed.acquisitionState)
    ) {
      refreshed =
        dependencies.repositories.media.updateState(
          season.id,
          aggregateChildAcquisitionState(episodes),
        ) ?? refreshed;
    }
    await enqueueSeasonAcquisition(refreshed, dependencies);
  }
  const parentState =
    selectedSeasons.length === 0
      ? stateAfterMonitoringStops(parent, dependencies)
      : aggregateChildAcquisitionState(
          selectedSeasons.map(
            (season) =>
              dependencies.repositories.media.get(season.id) ?? season,
          ),
        );
  dependencies.repositories.media.updateState(parent.id, parentState);
  const updated = dependencies.repositories.media.get(parent.id) ?? parent;
  recordActivity(
    dependencies,
    "library.monitoring-updated",
    "success",
    `Updated monitoring for ${updated.title}`,
    updated.id,
  );
  dependencies.events?.publish("library.changed", { id: updated.id });
  return updated;
}

function selectedSeasonNumbers(
  details: CatalogDetails,
  input: MonitoringInput,
): number[] {
  const available = details.numberOfSeasons ?? 0;
  if (input.seasonNumbers !== undefined) {
    const selected = [...new Set(input.seasonNumbers)].sort(
      (left, right) => left - right,
    );
    if (available > 0 && selected.some((number) => number > available)) {
      throw badRequest(`This series currently has ${available} seasons`);
    }
    return selected;
  }
  if (input.monitorPolicy === "all") {
    return Array.from({ length: available }, (_, index) => index + 1);
  }
  return available > 0 ? [available] : [];
}

function hasRecordedFiles(
  item: LibraryItem,
  dependencies: ApiDependencies,
): boolean {
  return mediaTree(item, dependencies).some(
    (member) =>
      dependencies.repositories.libraryFiles.listForMedia(member.id).length > 0,
  );
}

function stateAfterMonitoringStops(
  item: LibraryItem,
  dependencies: ApiDependencies,
): "available" | "unmonitored" {
  return item.acquisitionState === "available" ||
    hasRecordedFiles(item, dependencies)
    ? "available"
    : "unmonitored";
}

async function createMonitoredSeasons(
  parent: LibraryItem,
  details: CatalogDetails,
  input: z.infer<typeof MonitorMediaSchema>,
  dependencies: ApiDependencies,
  client: TmdbClient,
  language: string,
  signal?: AbortSignal,
): Promise<LibraryItem[]> {
  return ensureMonitoredSeasons({
    parent,
    seasonNumbers: selectedSeasonNumbers(details, input),
    dependencies,
    client,
    language,
    signal,
  });
}

export async function ensureMonitoredSeasons(options: {
  parent: LibraryItem;
  seasonNumbers: readonly number[];
  dependencies: Pick<ApiDependencies, "repositories">;
  client: TmdbClient;
  language: string;
  signal?: AbortSignal;
}): Promise<LibraryItem[]> {
  const { parent, seasonNumbers, dependencies, client, language, signal } =
    options;
  if (parent.kind !== "series" || parent.tmdbId === null) return [];
  const parentTmdbId = parent.tmdbId;

  const changedSeasons: LibraryItem[] = [];
  const existingSeasons = new Map<number, LibraryItem>(
    dependencies.repositories.media
      .children(parent.id)
      .filter(
        (item): item is LibraryItem & { seasonNumber: number } =>
          item.kind === "season" && item.seasonNumber !== null,
      )
      .map((item) => [item.seasonNumber, item]),
  );
  const uniqueNumbers = [...new Set(seasonNumbers)]
    .filter((number) => Number.isSafeInteger(number) && number > 0)
    .sort((left, right) => left - right);

  for (const seasonNumber of uniqueNumbers) {
    signal?.throwIfAborted();
    const season = await client
      .season(parentTmdbId, seasonNumber, { language, signal })
      .catch(() => null);
    const existingSeason = existingSeasons.get(seasonNumber);
    const acquisitionMode = seasonAcquisitionMode(season, existingSeason);
    let seasonItem =
      existingSeason ??
      dependencies.repositories.media.create({
        kind: "season",
        tmdbId: season?.tmdbId ?? null,
        parentId: parent.id,
        seasonNumber,
        episodeNumber: null,
        title: season?.name || `${parent.title} — Season ${seasonNumber}`,
        year: season?.airDate
          ? Number(season.airDate.slice(0, 4))
          : parent.year,
        posterUrl:
          tmdbImage(season?.posterPath ?? null, "w500") ?? parent.posterUrl,
        status: "missing",
        monitorPolicy: "selected",
        releaseDate: isoDate(season?.airDate ?? null),
        metadata: {
          seriesTmdbId: parent.tmdbId,
          overview: season?.overview ?? "",
          acquisitionMode,
        },
      });
    let changed = existingSeason === undefined;
    if (existingSeason && season) {
      const title = season.name || existingSeason.title;
      const year = season.airDate
        ? Number(season.airDate.slice(0, 4))
        : existingSeason.year;
      const posterUrl =
        tmdbImage(season.posterPath, "w500") ?? existingSeason.posterUrl;
      const releaseDate = isoDate(season.airDate);
      const metadataChanged =
        existingSeason.metadata["seriesTmdbId"] !== parent.tmdbId ||
        existingSeason.metadata["overview"] !== season.overview ||
        existingSeason.metadata["acquisitionMode"] !== acquisitionMode;
      const metadataNeedsHydration =
        existingSeason.tmdbId !== season.tmdbId ||
        existingSeason.title !== title ||
        existingSeason.year !== year ||
        existingSeason.posterUrl !== posterUrl ||
        existingSeason.releaseDate !== releaseDate ||
        metadataChanged;
      if (metadataNeedsHydration) {
        seasonItem =
          dependencies.repositories.media.updateMetadata(existingSeason.id, {
            tmdbId: season.tmdbId,
            title,
            year,
            posterUrl,
            releaseDate,
            metadata: {
              ...existingSeason.metadata,
              seriesTmdbId: parent.tmdbId,
              overview: season.overview,
              acquisitionMode,
            },
          }) ?? seasonItem;
        changed = true;
      }
    } else if (
      existingSeason &&
      existingSeason.metadata["acquisitionMode"] !== acquisitionMode
    ) {
      seasonItem =
        dependencies.repositories.media.updateMetadata(existingSeason.id, {
          metadata: {
            ...existingSeason.metadata,
            acquisitionMode,
          },
        }) ?? seasonItem;
      changed = true;
    }
    if (existingSeason?.monitorPolicy === "none") {
      seasonItem =
        dependencies.repositories.media.updateMonitorPolicy(
          existingSeason.id,
          "selected",
        ) ?? seasonItem;
      changed = true;
    }
    if (!existingSeason) {
      existingSeasons.set(seasonNumber, seasonItem);
    }
    const existingEpisodes = new Map(
      dependencies.repositories.media
        .children(seasonItem.id)
        .filter((item) => item.kind === "episode")
        .flatMap((item) =>
          item.episodeNumber === null
            ? []
            : [[item.episodeNumber, item] as const],
        ),
    );
    for (const episode of season?.episodes ?? []) {
      const existingEpisode = existingEpisodes.get(episode.episodeNumber);
      if (existingEpisode) {
        const year = episode.airDate
          ? Number(episode.airDate.slice(0, 4))
          : existingEpisode.year;
        const posterUrl =
          tmdbImage(episode.stillPath, "w500") ?? existingEpisode.posterUrl;
        const releaseDate = isoDate(episode.airDate);
        const incrementalAcquisition = acquisitionMode === "episodes";
        const metadataChanged =
          existingEpisode.metadata["seriesId"] !== parent.id ||
          existingEpisode.metadata["seriesTitle"] !== parent.title ||
          existingEpisode.metadata["overview"] !== episode.overview ||
          existingEpisode.metadata["runtimeMinutes"] !==
            episode.runtimeMinutes ||
          existingEpisode.metadata["incrementalAcquisition"] !==
            incrementalAcquisition;
        const metadataNeedsHydration =
          existingEpisode.tmdbId !== episode.tmdbId ||
          existingEpisode.title !== episode.name ||
          existingEpisode.year !== year ||
          existingEpisode.posterUrl !== posterUrl ||
          existingEpisode.releaseDate !== releaseDate ||
          metadataChanged;
        if (metadataNeedsHydration) {
          dependencies.repositories.media.updateMetadata(existingEpisode.id, {
            tmdbId: episode.tmdbId,
            title: episode.name,
            year,
            posterUrl,
            releaseDate,
            metadata: {
              ...existingEpisode.metadata,
              seriesId: parent.id,
              seriesTitle: parent.title,
              overview: episode.overview,
              runtimeMinutes: episode.runtimeMinutes,
              incrementalAcquisition,
            },
          });
          changed = true;
        }
        if (existingEpisode.monitorPolicy === "none") {
          dependencies.repositories.media.updateMonitorPolicy(
            existingEpisode.id,
            "selected",
          );
          changed = true;
        }
        continue;
      }
      const episodeItem = dependencies.repositories.media.create({
        kind: "episode",
        tmdbId: episode.tmdbId,
        parentId: seasonItem.id,
        seasonNumber,
        episodeNumber: episode.episodeNumber,
        title: episode.name,
        year: episode.airDate
          ? Number(episode.airDate.slice(0, 4))
          : parent.year,
        posterUrl: tmdbImage(episode.stillPath, "w500"),
        status: "missing",
        monitorPolicy: "selected",
        releaseDate: isoDate(episode.airDate),
        metadata: {
          seriesId: parent.id,
          seriesTitle: parent.title,
          overview: episode.overview,
          runtimeMinutes: episode.runtimeMinutes,
          incrementalAcquisition: acquisitionMode === "episodes",
        },
      });
      if (episodeItem.releaseDate) {
        dependencies.repositories.calendar.create({
          title: parent.title,
          kind: "release",
          scheduledAt: episodeItem.releaseDate,
          libraryItemId: episodeItem.id,
          status: "scheduled",
          metadata: {
            mediaKind: "episode",
            subtitle: `S${String(seasonNumber).padStart(2, "0")}E${String(episode.episodeNumber).padStart(2, "0")} · ${episode.name}`,
            posterUrl: parent.posterUrl,
            acquisitionState: episodeItem.acquisitionState,
          },
        });
      }
      changed = true;
    }
    if (changed) changedSeasons.push(seasonItem);
  }
  return changedSeasons;
}

function libraryView(item: LibraryItem) {
  const metadata = item.metadata;
  return {
    ...item,
    posterPath: item.posterUrl,
    overview:
      typeof metadata["overview"] === "string" ? metadata["overview"] : "",
    releaseDate: item.releaseDate,
    addedAt: item.createdAt,
  };
}

function mediaTree(
  root: LibraryItem,
  dependencies: ApiDependencies,
): LibraryItem[] {
  const items = [root];
  for (const child of dependencies.repositories.media.children(root.id)) {
    items.push(...mediaTree(child, dependencies));
  }
  return items;
}

async function cancelAcquisitionJobs(
  mediaIds: readonly string[],
  dependencies: ApiDependencies,
): Promise<void> {
  await cancelJobsByPayload(
    ["media.acquire.v1"],
    "mediaId",
    mediaIds,
    dependencies,
  );
}

async function cancelDownloadJobs(
  downloadIds: readonly string[],
  dependencies: ApiDependencies,
): Promise<void> {
  await cancelJobsByPayload(
    [ADD_TORRENT_JOB, ORGANIZE_DOWNLOAD_JOB],
    "downloadId",
    downloadIds,
    dependencies,
  );
}

async function cancelJobsByPayload(
  types: readonly string[],
  payloadKey: string,
  values: readonly string[],
  dependencies: ApiDependencies,
): Promise<void> {
  if (!dependencies.queue || values.length === 0) return;
  const matchingValues = new Set(values);
  const jobs = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await dependencies.queue.list({
      types,
      states: ["queued", "running"],
      limit: 1_000,
      offset,
    });
    jobs.push(...page);
    if (page.length < 1_000) break;
  }
  for (const job of jobs) {
    const payloadValue =
      typeof job.payload === "object" && job.payload !== null
        ? (job.payload as Record<string, unknown>)[payloadKey]
        : undefined;
    if (typeof payloadValue !== "string" || !matchingValues.has(payloadValue)) {
      continue;
    }
    const cancelled = await (dependencies.cancelJob?.(job.id) ??
      dependencies.queue.cancel(job.id));
    if (cancelled) dependencies.events?.publish("job.changed", { id: job.id });
  }
}

async function enqueueAcquisition(
  item: LibraryItem,
  dependencies: ApiDependencies,
  force = false,
) {
  if (!dependencies.queue || item.monitorPolicy === "none") return null;
  const job = await dependencies.queue.enqueue({
    type: "media.acquire.v1",
    payload: { version: 1, mediaId: item.id },
    dedupeKey: force ? `${item.id}:${Date.now()}` : item.id,
    maxAttempts: 5,
  });
  dependencies.events?.publish("job.changed", { id: job.id });
  return job;
}

async function enqueueSeasonAcquisition(
  season: LibraryItem,
  dependencies: ApiDependencies,
): Promise<void> {
  if (!seasonUsesEpisodeAcquisition(season)) {
    if (["missing", "failed"].includes(season.acquisitionState)) {
      await enqueueAcquisition(season, dependencies);
    }
    return;
  }

  await cancelAcquisitionJobs([season.id], dependencies);
  const episodes = dependencies.repositories.media.children(season.id);
  for (const episode of episodes) {
    if (
      episode.kind !== "episode" ||
      !["missing", "failed"].includes(episode.acquisitionState)
    ) {
      continue;
    }
    const parsedReleaseAt = episode.releaseDate
      ? Date.parse(episode.releaseDate)
      : Date.now();
    const releaseAt = Number.isFinite(parsedReleaseAt)
      ? parsedReleaseAt
      : Date.now();
    if (!dependencies.queue || episode.monitorPolicy === "none") continue;
    const job = await dependencies.queue.enqueue({
      type: "media.acquire.v1",
      payload: { version: 1, mediaId: episode.id },
      dedupeKey: episode.id,
      runAt: Math.max(Date.now(), releaseAt),
      maxAttempts: 5,
    });
    dependencies.events?.publish("job.changed", { id: job.id });
  }
  dependencies.repositories.media.updateState(
    season.id,
    aggregateChildAcquisitionState(episodes),
  );
}

async function stopMediaAutomation(
  media: LibraryItem,
  dependencies: ApiDependencies,
): Promise<LibraryItem[]> {
  const tree = mediaTree(media, dependencies);
  for (const member of tree) {
    dependencies.repositories.media.updateMonitorPolicy(member.id, "none");
    dependencies.repositories.media.updateState(
      member.id,
      stateAfterMonitoringStops(member, dependencies),
    );
    if (member.metadata["replacementPending"] === true) {
      dependencies.repositories.media.updateMetadata(member.id, {
        metadata: { ...member.metadata, replacementPending: false },
      });
    }
  }
  await cancelAcquisitionJobs(
    tree.map((member) => member.id),
    dependencies,
  );
  recomputeAncestorAcquisitionStates(media.parentId, dependencies);
  dependencies.events?.publish("library.changed", { id: media.id });
  return tree;
}

function recomputeAncestorAcquisitionStates(
  initialParentId: string | null,
  dependencies: ApiDependencies,
): void {
  let parentId = initialParentId;
  while (parentId) {
    const parent = dependencies.repositories.media.get(parentId);
    if (!parent) return;
    dependencies.repositories.media.updateState(
      parent.id,
      aggregateChildAcquisitionState(
        dependencies.repositories.media.children(parent.id),
      ),
    );
    parentId = parent.parentId;
  }
}

function markReplacementPending(
  item: LibraryItem,
  dependencies: ApiDependencies,
): void {
  dependencies.repositories.media.updateMetadata(item.id, {
    metadata: {
      ...item.metadata,
      replacementPending: true,
      replacementRequestedAt: new Date().toISOString(),
    },
  });
}

async function resolveReleaseContext(
  query: z.infer<typeof ReleaseSearchQuerySchema>,
  dependencies: ApiDependencies,
  signal?: AbortSignal,
): Promise<{ target: ReleaseTarget; mediaId: string | null }> {
  const existing = dependencies.repositories.media.getByTmdb(
    query.kind,
    query.tmdbId,
  );
  const details = existing
    ? null
    : await (async () => {
        const settings =
          dependencies.repositories.settings.ensureDefaults().settings;
        const client = await requireIntegrations(dependencies).tmdb();
        return cachedTmdb(
          dependencies,
          query.kind,
          catalogDetailsCacheId(query.tmdbId),
          localeKey(settings),
          24 * 60 * 60_000,
          () =>
            integrationCall("tmdb", () =>
              client.details(toTmdbKind(query.kind), query.tmdbId, {
                language: settings.locale.language,
                signal,
              }),
            ),
        );
      })();
  const title = existing?.title ?? details!.title;
  const year = existing?.year ?? details!.year ?? undefined;
  if (query.kind === "movie") {
    return {
      target: {
        kind: "movie",
        title,
        year,
        releaseDate: existing
          ? existing.releaseDate
          : isoDate(details!.releaseDate),
      },
      mediaId: existing?.id ?? null,
    };
  }

  const monitoredSeasons = existing
    ? dependencies.repositories.media
        .children(existing.id)
        .filter(
          (item): item is LibraryItem & { seasonNumber: number } =>
            item.kind === "season" &&
            item.seasonNumber !== null &&
            item.monitorPolicy !== "none",
        )
        .sort((left, right) => right.seasonNumber - left.seasonNumber)
    : [];
  const selectedSeason =
    query.season === undefined
      ? monitoredSeasons[0]
      : monitoredSeasons.find((season) => season.seasonNumber === query.season);
  if (existing && query.season !== undefined && !selectedSeason) {
    throw badRequest(`Season ${query.season} is not monitored`);
  }
  const selectedEpisode =
    selectedSeason && query.episode !== undefined
      ? dependencies.repositories.media
          .children(selectedSeason.id)
          .find(
            (episode) =>
              episode.kind === "episode" &&
              episode.episodeNumber === query.episode &&
              episode.monitorPolicy !== "none",
          )
      : undefined;
  if (selectedSeason && query.episode !== undefined && !selectedEpisode) {
    throw badRequest(
      `Episode ${query.episode} is not monitored in season ${selectedSeason.seasonNumber}`,
    );
  }
  const season =
    query.season ??
    selectedSeason?.seasonNumber ??
    details?.numberOfSeasons ??
    1;
  const persistedReleaseDate =
    selectedEpisode?.releaseDate ?? selectedSeason?.releaseDate ?? null;
  const releaseDate =
    persistedReleaseDate ??
    (await tvTargetReleaseDate(
      dependencies,
      query.tmdbId,
      season,
      query.episode,
      signal,
    ));
  return {
    target: query.episode
      ? {
          kind: "episode",
          title,
          year,
          season,
          episode: query.episode,
          releaseDate,
        }
      : { kind: "season", title, year, season, releaseDate },
    mediaId: selectedEpisode?.id ?? selectedSeason?.id ?? null,
  };
}

async function tvTargetReleaseDate(
  dependencies: ApiDependencies,
  tmdbId: number,
  seasonNumber: number,
  episodeNumber: number | undefined,
  signal?: AbortSignal,
): Promise<string | null> {
  const settings = dependencies.repositories.settings.ensureDefaults().settings;
  const client = await requireIntegrations(dependencies).tmdb();
  const season = await cachedTmdb(
    dependencies,
    "season",
    `season:${tmdbId}:${seasonNumber}`,
    localeKey(settings),
    6 * 60 * 60_000,
    () =>
      integrationCall("tmdb", () =>
        client.season(tmdbId, seasonNumber, {
          language: settings.locale.language,
          signal,
        }),
      ),
  );
  const value =
    episodeNumber === undefined
      ? season.airDate
      : (season.episodes.find(
          (episode) => episode.episodeNumber === episodeNumber,
        )?.airDate ?? null);
  return isoDate(value);
}

async function acquisitionSearch(
  dependencies: ApiDependencies,
  target: ReleaseTarget,
  tmdbId: number,
  mediaId: string | undefined,
  query?: string,
  signal?: AbortSignal,
): Promise<CandidateSearchResult> {
  const settings = dependencies.repositories.settings.ensureDefaults().settings;
  const profile: ReleaseProfile = {
    minimumSeeders: settings.acquisition.minimumSeeders,
    ...(settings.acquisition.minimumSizeMb === null
      ? {}
      : { minimumSizeBytes: settings.acquisition.minimumSizeMb * 1024 * 1024 }),
    ...(settings.acquisition.maximumSizeMb === null
      ? {}
      : { maximumSizeBytes: settings.acquisition.maximumSizeMb * 1024 * 1024 }),
    qualityOrder: validQualities(settings.acquisition.qualityOrder),
    requiredTerms: settings.acquisition.requiredTerms,
    excludedTerms: settings.acquisition.rejectedTerms,
    preferredTerms: Object.fromEntries(
      settings.acquisition.preferredTerms.map((term, index) => [
        term,
        settings.acquisition.preferredTerms.length - index,
      ]),
    ),
  };
  const service = await requireAcquisition(dependencies);
  return acquisitionCall(() =>
    service.searchCandidates({
      target,
      profile,
      tmdbId,
      mediaId,
      query,
      signal,
    }),
  );
}

function validQualities(
  values: string[],
): Array<"2160p" | "1080p" | "720p" | "480p" | "unknown"> {
  const allowed = new Set(["2160p", "1080p", "720p", "480p", "unknown"]);
  const result = values.filter(
    (value): value is "2160p" | "1080p" | "720p" | "480p" | "unknown" =>
      allowed.has(value),
  );
  return result.length ? result : ["1080p", "2160p", "720p", "480p", "unknown"];
}

function releaseResult(
  result: CandidateSearchResult,
  kind: "movie" | "series",
  tmdbId: number,
  mediaId: string | null,
  replacementRequired: boolean,
) {
  const eligible = result.candidates.map((candidate) => ({
    id: candidate.id,
    mediaId,
    tmdbId,
    mediaKind: kind,
    title: candidate.title,
    indexer: candidate.indexer ?? "unknown",
    sizeBytes: candidate.sizeBytes,
    size: candidate.sizeBytes,
    seeders: candidate.seeders,
    leechers: candidate.peers,
    publishedAt: null,
    quality:
      candidate.facts.quality === "unknown" ? null : candidate.facts.quality,
    score: candidate.score,
    eligible: true,
    reasons: [...candidate.reasons],
    scoreExplanation: candidate.reasons.map((label) => ({
      label,
      value: scoreValue(label),
    })),
    expiresAt: new Date(candidate.expiresAt).toISOString(),
    createdAt: new Date(result.expiresAt - 30 * 60_000).toISOString(),
  }));
  const rejected = result.excluded.map((candidate) => ({
    id: `rel_${crypto.getRandomValues(new Uint8Array(32)).toBase64({ alphabet: "base64url", omitPadding: true })}`,
    mediaId,
    tmdbId,
    mediaKind: kind,
    title: candidate.title,
    indexer: candidate.indexer ?? "unknown",
    sizeBytes: 0,
    size: 0,
    seeders: 0,
    leechers: 0,
    publishedAt: null,
    quality: null,
    score: -1,
    eligible: false,
    reasons: [...candidate.exclusions],
    scoreExplanation: [],
    expiresAt: new Date(result.expiresAt).toISOString(),
    createdAt: new Date(result.expiresAt - 30 * 60_000).toISOString(),
  }));
  return {
    items: [...eligible, ...rejected],
    candidates: [...eligible, ...rejected],
    expiresAt: new Date(result.expiresAt).toISOString(),
    query: result.query,
    mediaId,
    replacementRequired,
  };
}

function scoreValue(label: string): number {
  const match = /([+-]\d+)/.exec(label);
  return match ? Number(match[1]) : 0;
}

function magnetDisplayName(value: string): string {
  try {
    const name = new URL(value).searchParams.get("dn")?.trim();
    return name ? name.slice(0, 500) : "Manual download";
  } catch {
    return "Manual download";
  }
}

async function controlDownload(
  context: Context<ApiEnvironment>,
  dependencies: ApiDependencies,
  action: "pause" | "resume",
) {
  const id = parse(DownloadParamsSchema, context.req.param()).id;
  const download = dependencies.repositories.downloads.get(id);
  if (!download) throw notFound("Download not found");
  if (!download.externalId)
    throw conflictError("Download has not been submitted to Transmission");
  const owned = await requireOwnedTorrent(
    download,
    dependencies,
    context.req.raw.signal,
  );
  await integrationCall("transmission", () =>
    action === "pause"
      ? owned.transmission.pause(owned.torrent.hash, context.req.raw.signal)
      : owned.transmission.start(owned.torrent.hash, context.req.raw.signal),
  );
  const durableDownloads = downloadRepositoryFromDatabase(
    dependencies.database,
  );
  const durable = await durableDownloads.findById(id);
  if (durable) {
    await durableDownloads.transition(id, [durable.state], {
      state: action === "pause" ? "paused" : "downloading",
      error: null,
      updatedAt: Date.now(),
      lastEngineSeenAt: Date.now(),
    });
  } else {
    dependencies.repositories.downloads.update(id, {
      state: action === "pause" ? "paused" : "downloading",
    });
  }
  const updated = dependencies.repositories.downloads.get(id);
  dependencies.events?.publish("download.changed", { id });
  return context.json(updated ?? download);
}

function libraryScanRoots(
  kind: "movie" | "series" | undefined,
  storage: {
    moviesPath: string;
    televisionPath: string;
  },
): string[] {
  if (kind === "movie") return [storage.moviesPath];
  if (kind === "series") return [storage.televisionPath];
  return [storage.moviesPath, storage.televisionPath];
}

async function deleteRecordedLibraryFiles(
  mediaId: string,
  dependencies: ApiDependencies,
): Promise<void> {
  const settings = dependencies.repositories.settings.ensureDefaults().settings;
  const roots = [settings.storage.moviesPath, settings.storage.televisionPath];
  for (const file of dependencies.repositories.libraryFiles.listForMedia(
    mediaId,
  )) {
    try {
      await deleteRecordedFile(file.path, roots);
    } catch (error) {
      if (error instanceof UnsafeLibraryDeletionError) {
        throw badRequest(error.message);
      }
      throw error;
    }
    dependencies.repositories.libraryFiles.delete(file.id);
  }
}

async function removeMediaTorrents(
  mediaId: string,
  deleteData: boolean,
  dependencies: ApiDependencies,
): Promise<void> {
  const downloads: Download[] = [];
  let offset = 0;
  while (true) {
    const page = dependencies.repositories.downloads.list({
      limit: 100,
      offset,
      mediaId,
    });
    downloads.push(...page.downloads);
    offset += page.downloads.length;
    if (page.downloads.length === 0 || offset >= page.total) break;
  }
  const durableDownloads = downloadRepositoryFromDatabase(
    dependencies.database,
  );
  await cancelDownloadJobs(
    downloads.map((download) => download.id),
    dependencies,
  );
  for (const download of downloads) {
    if (download.externalId) {
      const owned = await requireOwnedTorrent(download, dependencies);
      await integrationCall("transmission", () =>
        owned.transmission.remove(owned.torrent.hash, deleteData),
      );
    }
    const durable = await durableDownloads.findById(download.id);
    if (durable) {
      await durableDownloads.transition(download.id, [durable.state], {
        state: "removed",
        error: "Removed with library item",
        updatedAt: Date.now(),
      });
    } else {
      dependencies.repositories.downloads.update(download.id, {
        state: "failed",
        error: "Removed with library item",
      });
    }
    dependencies.events?.publish("download.changed", { id: download.id });
  }
}

const ACTIVE_REPLACEMENT_DOWNLOAD_STATES = new Set<Download["state"]>([
  "queued",
  "downloading",
  "paused",
  "checking",
  "seeding",
  "organizing",
]);

function mediaDownloads(
  mediaId: string,
  dependencies: ApiDependencies,
): Download[] {
  const downloads: Download[] = [];
  let offset = 0;
  while (true) {
    const page = dependencies.repositories.downloads.list({
      limit: 100,
      offset,
      mediaId,
    });
    downloads.push(...page.downloads);
    offset += page.downloads.length;
    if (page.downloads.length === 0 || offset >= page.total) break;
  }
  return downloads;
}

function activeReplacementDownloads(
  mediaId: string,
  dependencies: ApiDependencies,
): Download[] {
  return mediaDownloads(mediaId, dependencies).filter((download) =>
    ACTIVE_REPLACEMENT_DOWNLOAD_STATES.has(download.state),
  );
}

function isExplicitReplacementTarget(
  mediaId: string,
  dependencies: ApiDependencies,
): boolean {
  const item = dependencies.repositories.media.get(mediaId);
  return Boolean(
    item &&
    (hasRecordedFiles(item, dependencies) ||
      activeReplacementDownloads(mediaId, dependencies).length > 0),
  );
}

async function verifyReplacementOwnership(
  downloads: readonly Download[],
  dependencies: ApiDependencies,
): Promise<void> {
  const durableDownloads = downloadRepositoryFromDatabase(
    dependencies.database,
  );
  for (const download of downloads) {
    if (!(await durableDownloads.findById(download.id))) {
      throw conflictError("Download ownership record is unavailable");
    }
    if (download.externalId) {
      await requireOwnedTorrent(download, dependencies);
    }
  }
}

async function retireSupersededDownloads(
  downloadIds: readonly string[],
  dependencies: ApiDependencies,
): Promise<void> {
  if (downloadIds.length === 0) return;
  await cancelDownloadJobs(downloadIds, dependencies);
  const durableDownloads = downloadRepositoryFromDatabase(
    dependencies.database,
  );
  const prepared: Array<{
    download: Download;
    durable: DownloadRecord;
    owned?: Awaited<ReturnType<typeof requireOwnedTorrent>>;
  }> = [];
  for (const id of downloadIds) {
    const download = dependencies.repositories.downloads.get(id);
    if (!download) continue;
    const durable = await durableDownloads.findById(id);
    if (!durable) {
      throw conflictError("Download ownership record is unavailable");
    }
    prepared.push({
      download,
      durable,
      ...(download.externalId
        ? { owned: await requireOwnedTorrent(download, dependencies) }
        : {}),
    });
  }
  for (const entry of prepared) {
    if (entry.owned) {
      await integrationCall("transmission", () =>
        entry.owned!.transmission.remove(entry.owned!.torrent.hash, true),
      );
    }
  }
  for (const entry of prepared) {
    const removed = await durableDownloads.transition(
      entry.download.id,
      [entry.durable.state],
      {
        state: "removed",
        error: "Superseded by an explicit replacement",
        updatedAt: Date.now(),
      },
    );
    if (!removed) {
      throw conflictError("Superseded download changed during replacement");
    }
    dependencies.events?.publish("download.changed", {
      id: entry.download.id,
    });
  }
}

async function requireOwnedTorrent(
  download: { id: string; externalId: string | null },
  dependencies: ApiDependencies,
  signal?: AbortSignal,
): Promise<{
  durable: DownloadRecord;
  torrent: TorrentSnapshot;
  transmission: TorrentEngine;
}> {
  const durable = await downloadRepositoryFromDatabase(
    dependencies.database,
  ).findById(download.id);
  if (!durable) {
    throw conflictError("Download ownership record is unavailable");
  }
  if (!download.externalId) {
    throw conflictError("Download has not been submitted to Transmission");
  }
  const transmission = await requireIntegrations(dependencies).transmission();
  const torrent = await integrationCall("transmission", () =>
    transmission.get(download.externalId!, signal),
  );
  if (!torrent) {
    throw conflictError("Owned Transmission torrent is unavailable");
  }
  const downloadRoot =
    dependencies.repositories.settings.ensureDefaults().settings.storage
      .downloadsPath;
  if (!isOwnedTorrent(durable, torrent, downloadRoot, download.externalId)) {
    throw conflictError("Transmission torrent ownership could not be verified");
  }
  return { durable, torrent, transmission };
}

async function findOwnedTorrentForRemoval(
  download: { id: string; externalId: string | null },
  dependencies: ApiDependencies,
  signal?: AbortSignal,
): Promise<{
  durable: DownloadRecord;
  torrent: TorrentSnapshot;
  transmission: TorrentEngine;
} | null> {
  if (!download.externalId) return null;
  const transmission = await requireIntegrations(dependencies).transmission();
  const torrent = await integrationCall("transmission", () =>
    transmission.get(download.externalId!, signal),
  );
  if (!torrent) return null;
  const durable = await downloadRepositoryFromDatabase(
    dependencies.database,
  ).findById(download.id);
  if (!durable) {
    throw conflictError("Download ownership record is unavailable");
  }
  const downloadRoot =
    dependencies.repositories.settings.ensureDefaults().settings.storage
      .downloadsPath;
  if (!isOwnedTorrent(durable, torrent, downloadRoot, download.externalId)) {
    throw conflictError("Transmission torrent ownership could not be verified");
  }
  return { durable, torrent, transmission };
}

async function validateStorage(input: z.infer<typeof StorageValidationSchema>) {
  const paths = [input.downloadsPath, input.moviesPath, input.televisionPath];
  try {
    await Promise.all(
      paths.map(async (path) => {
        await access(path);
        if (!(await stat(path)).isDirectory())
          throw new Error(`${path} is not a directory`);
      }),
    );
    if (input.organizationStrategy === "hardlink") {
      const devices = await Promise.all(
        paths.map(async (path) => (await stat(path)).dev),
      );
      if (new Set(devices).size !== 1)
        return {
          valid: false,
          message:
            "Hardlinks require downloads and library roots on one filesystem",
        };
    }
    return { valid: true, message: "Storage roots are accessible" };
  } catch (error) {
    return {
      valid: false,
      message:
        error instanceof Error ? error.message : "Storage validation failed",
    };
  }
}

function recordActivity(
  dependencies: ApiDependencies,
  type: string,
  level: "info" | "success" | "warning" | "error",
  message: string,
  entityId: string | null,
): void {
  const event = dependencies.repositories.activity.append({
    type,
    level,
    message,
    entityType: entityId ? "media" : null,
    entityId,
    data: {},
  });
  dependencies.events?.publish("activity.created", { id: event.id });
}

function requireIntegrations(dependencies: ApiDependencies) {
  if (!dependencies.integrations)
    throw unavailable("Integrations are unavailable");
  return dependencies.integrations;
}

function requireQueue(dependencies: ApiDependencies) {
  if (!dependencies.queue)
    throw unavailable("The durable job queue is unavailable");
  return dependencies.queue;
}

async function requireAcquisition(
  dependencies: ApiDependencies,
): Promise<AcquisitionService> {
  if (!dependencies.acquisition)
    throw unavailable("Torrent acquisition is unavailable");
  return dependencies.acquisition();
}

async function integrationCall<T>(
  integration: IntegrationKey,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({
      code: "integration_error",
      message: `${integrationLabel(integration)} request failed: ${error instanceof Error ? error.message : "unknown error"}`,
      status: 503,
      cause: error,
    });
  }
}

async function acquisitionCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CandidateUnavailableError) {
      throw new AppError({
        code: "candidate_expired",
        message: error.message,
        status: 409,
        cause: error,
      });
    }
    if (error instanceof InvalidAcquisitionSourceError) {
      throw new AppError({
        code: "invalid_magnet",
        message: error.message,
        status: 400,
        cause: error,
      });
    }
    if (error instanceof AppError) throw error;
    throw new AppError({
      code: "integration_error",
      message: error instanceof Error ? error.message : "Acquisition failed",
      status: 503,
      cause: error,
    });
  }
}

function integrationLabel(key: IntegrationKey): string {
  if (key === "tmdb") return "TMDB";
  if (key === "jackett") return "Jackett";
  if (key === "transmission") return "Transmission";
  return "OMDb";
}

function badRequest(message: string): AppError {
  return new AppError({ code: "bad_request", message, status: 400 });
}

function contentDisposition(filename: string): string {
  const fallback =
    filename
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_")
      .replace(/[\r\n]/g, "_") || "download";
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function conflictError(message: string): AppError {
  return new AppError({ code: "conflict", message, status: 409 });
}

function unavailable(message: string): AppError {
  return new AppError({ code: "service_unavailable", message, status: 503 });
}

function internalError(message: string): AppError {
  return new AppError({ code: "internal_error", message, status: 500 });
}
