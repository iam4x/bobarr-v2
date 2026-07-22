import {
  IntegrationError,
  type FetchLike,
  asFiniteNumber,
  asString,
  isRecord,
  parseJsonResponse,
  requestSignal,
} from "./http";

const DEFAULT_BASE_URL = "https://api.themoviedb.org/3/";
const DEFAULT_TIMEOUT_MS = 10_000;
const HIGHEST_RATED_MIN_VOTE_COUNT = 200;

export type CatalogMediaType = "movie" | "tv";

export interface CatalogItem {
  mediaType: CatalogMediaType;
  tmdbId: number;
  title: string;
  originalTitle: string;
  overview: string;
  originalLanguage: string;
  releaseDate: string | null;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  genreIds: readonly number[];
  popularity: number;
  voteAverage: number;
  voteCount: number;
}

export interface CatalogPage {
  page: number;
  totalPages: number;
  totalResults: number;
  results: readonly CatalogItem[];
}

export interface CatalogGenre {
  id: number;
  name: string;
}

export interface CatalogLanguage {
  code: string;
  englishName: string;
  name: string;
}

export interface CatalogCountry {
  code: string;
  englishName: string;
  nativeName: string;
}

export interface CatalogDetails extends CatalogItem {
  genres: readonly CatalogGenre[];
  runtimeMinutes: number | null;
  status: string | null;
  tagline: string | null;
  homepage: string | null;
  externalId: string | null;
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
}

export interface TvEpisode {
  tmdbId: number;
  name: string;
  overview: string;
  airDate: string | null;
  episodeNumber: number;
  seasonNumber: number;
  runtimeMinutes: number | null;
  stillPath: string | null;
  voteAverage: number;
}

export interface TvSeason {
  tmdbId: number;
  name: string;
  overview: string;
  airDate: string | null;
  seasonNumber: number;
  posterPath: string | null;
  episodes: readonly TvEpisode[];
}

export interface CatalogQueryOptions {
  language?: string;
  page?: number;
  region?: string;
  includeAdult?: boolean;
  year?: number;
  signal?: AbortSignal;
}

export interface CatalogSearchOptions extends CatalogQueryOptions {
  mediaType?: CatalogMediaType;
}

export interface DiscoverOptions extends CatalogQueryOptions {
  genres?: readonly number[];
  genreMode?: "all" | "any";
  originCountry?: string;
  originalLanguage?: string;
  dateFrom?: string;
  dateTo?: string;
  minimumRuntimeMinutes?: number;
  maximumRuntimeMinutes?: number;
  minimumVoteCount?: number;
  minimumVoteAverage?: number;
  sortBy?: DiscoverSort;
}

type DiscoverSortField =
  | "popularity"
  | "vote_average"
  | "vote_count"
  | "release_date"
  | "primary_release_date"
  | "first_air_date"
  | "title"
  | "name"
  | "original_title"
  | "original_name"
  | "revenue";

export type DiscoverSort = `${DiscoverSortField}.${"asc" | "desc"}`;

export interface TmdbClient {
  search(query: string, options?: CatalogSearchOptions): Promise<CatalogPage>;
  popular(
    mediaType: CatalogMediaType,
    options?: CatalogQueryOptions,
  ): Promise<CatalogPage>;
  discover(
    mediaType: CatalogMediaType,
    options?: DiscoverOptions,
  ): Promise<CatalogPage>;
  recommendations(
    mediaType: CatalogMediaType,
    tmdbId: number,
    options?: CatalogQueryOptions,
  ): Promise<CatalogPage>;
  details(
    mediaType: CatalogMediaType,
    tmdbId: number,
    options?: Pick<CatalogQueryOptions, "language" | "signal">,
  ): Promise<CatalogDetails>;
  season(
    tvTmdbId: number,
    seasonNumber: number,
    options?: Pick<CatalogQueryOptions, "language" | "signal">,
  ): Promise<TvSeason>;
  genres(
    mediaType: CatalogMediaType,
    options?: Pick<CatalogQueryOptions, "language" | "signal">,
  ): Promise<readonly CatalogGenre[]>;
  languages(signal?: AbortSignal): Promise<readonly CatalogLanguage[]>;
  countries(
    options?: Pick<CatalogQueryOptions, "language" | "signal">,
  ): Promise<readonly CatalogCountry[]>;
}

export interface TmdbClientOptions {
  accessToken?: string;
  apiKey?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export function createTmdbClient(options: TmdbClientOptions): TmdbClient {
  if (!options.accessToken && !options.apiKey) {
    throw new TypeError("A TMDB access token or API key is required");
  }
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request(
    path: string,
    parameters: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = new URL(path.replace(/^\/+/, ""), baseUrl);
    for (const [key, value] of parameters) {
      url.searchParams.append(key, value);
    }
    if (options.apiKey) {
      url.searchParams.set("api_key", options.apiKey);
    }
    const headers = new Headers({ accept: "application/json" });
    if (options.accessToken) {
      headers.set("authorization", `Bearer ${options.accessToken}`);
    }

    let response: Response;
    try {
      response = await fetcher(url, {
        headers,
        signal: requestSignal(timeoutMs, signal),
      });
    } catch (error) {
      throw new IntegrationError("tmdb", "TMDB request failed", {
        cause: error,
        retryable: true,
      });
    }
    const payload = await parseJsonResponse("tmdb", response);
    if (!response.ok) {
      const message = isRecord(payload)
        ? asString(payload["status_message"])
        : undefined;
      throw new IntegrationError(
        "tmdb",
        message ?? `TMDB returned HTTP ${response.status}`,
        {
          status: response.status,
          retryable: response.status === 429 || response.status >= 500,
          details: payload,
        },
      );
    }
    return payload;
  }

  return {
    async search(query, queryOptions = {}) {
      const normalizedQuery = query.trim();
      if (!normalizedQuery) {
        throw new TypeError("TMDB search query cannot be empty");
      }
      const parameters = pageParameters(queryOptions);
      parameters.set("query", normalizedQuery);
      parameters.set(
        "include_adult",
        String(queryOptions.includeAdult ?? false),
      );
      const mediaType = queryOptions.mediaType
        ? validateMediaType(queryOptions.mediaType)
        : undefined;
      if (queryOptions.year !== undefined) {
        parameters.set(
          mediaType === "tv" ? "first_air_date_year" : "year",
          String(validYear(queryOptions.year)),
        );
      }
      const payload = await request(
        `search/${mediaType ?? "multi"}`,
        parameters,
        queryOptions.signal,
      );
      return parseCatalogPage(payload, mediaType);
    },

    async popular(mediaType, queryOptions = {}) {
      const payload = await request(
        `${validateMediaType(mediaType)}/popular`,
        pageParameters(queryOptions),
        queryOptions.signal,
      );
      return parseCatalogPage(payload, mediaType);
    },

    async discover(mediaType, queryOptions = {}) {
      const validatedType = validateMediaType(mediaType);
      const parameters = pageParameters({
        ...queryOptions,
        region: validatedType === "movie" ? queryOptions.region : undefined,
      });
      parameters.set(
        "include_adult",
        String(queryOptions.includeAdult ?? false),
      );
      if (queryOptions.year !== undefined) {
        parameters.set(
          validatedType === "movie"
            ? "primary_release_year"
            : "first_air_date_year",
          String(validYear(queryOptions.year)),
        );
      }
      if (
        queryOptions.year !== undefined &&
        (queryOptions.dateFrom !== undefined ||
          queryOptions.dateTo !== undefined)
      ) {
        throw new TypeError("Discover accepts either year or a date range");
      }
      if (queryOptions.genres?.length) {
        parameters.set(
          "with_genres",
          validGenres(queryOptions.genres).join(
            queryOptions.genreMode === "any" ? "|" : ",",
          ),
        );
      }
      if (
        queryOptions.genreMode !== undefined &&
        queryOptions.genreMode !== "all" &&
        queryOptions.genreMode !== "any"
      ) {
        throw new TypeError("Genre mode must be all or any");
      }
      if (queryOptions.originCountry !== undefined) {
        parameters.set(
          "with_origin_country",
          validCountryCode(queryOptions.originCountry),
        );
      }
      if (queryOptions.originalLanguage !== undefined) {
        parameters.set(
          "with_original_language",
          validLanguageCode(queryOptions.originalLanguage),
        );
      }
      const dateParameter =
        validatedType === "movie" ? "primary_release_date" : "first_air_date";
      if (queryOptions.dateFrom !== undefined) {
        parameters.set(
          `${dateParameter}.gte`,
          validDate(queryOptions.dateFrom),
        );
      }
      if (queryOptions.dateTo !== undefined) {
        parameters.set(`${dateParameter}.lte`, validDate(queryOptions.dateTo));
      }
      if (
        queryOptions.dateFrom !== undefined &&
        queryOptions.dateTo !== undefined &&
        queryOptions.dateFrom > queryOptions.dateTo
      ) {
        throw new TypeError("Discover dateFrom must not be after dateTo");
      }
      if (queryOptions.minimumRuntimeMinutes !== undefined) {
        parameters.set(
          "with_runtime.gte",
          String(validRuntime(queryOptions.minimumRuntimeMinutes)),
        );
      }
      if (queryOptions.maximumRuntimeMinutes !== undefined) {
        parameters.set(
          "with_runtime.lte",
          String(validRuntime(queryOptions.maximumRuntimeMinutes)),
        );
      }
      if (
        queryOptions.minimumRuntimeMinutes !== undefined &&
        queryOptions.maximumRuntimeMinutes !== undefined &&
        queryOptions.minimumRuntimeMinutes > queryOptions.maximumRuntimeMinutes
      ) {
        throw new TypeError(
          "Discover minimum runtime must not exceed maximum runtime",
        );
      }
      if (queryOptions.minimumVoteAverage !== undefined) {
        parameters.set(
          "vote_average.gte",
          String(validRating(queryOptions.minimumVoteAverage)),
        );
      }
      const sortBy = normalizeDiscoverSort(
        validatedType,
        queryOptions.sortBy ?? "popularity.desc",
      );
      parameters.set("sort_by", sortBy);
      const minimumVoteCount =
        queryOptions.minimumVoteCount ??
        (sortBy === "vote_average.desc"
          ? HIGHEST_RATED_MIN_VOTE_COUNT
          : undefined);
      if (minimumVoteCount !== undefined) {
        parameters.set(
          "vote_count.gte",
          String(validVoteCount(minimumVoteCount)),
        );
      }
      const payload = await request(
        `discover/${validatedType}`,
        parameters,
        queryOptions.signal,
      );
      return parseCatalogPage(payload, mediaType);
    },

    async recommendations(mediaType, tmdbId, queryOptions = {}) {
      const validatedType = validateMediaType(mediaType);
      const payload = await request(
        `${validatedType}/${positiveId(tmdbId)}/recommendations`,
        pageParameters(queryOptions),
        queryOptions.signal,
      );
      return parseCatalogPage(payload, validatedType);
    },

    async details(mediaType, tmdbId, queryOptions = {}) {
      const parameters = languageParameters(queryOptions.language);
      if (mediaType === "tv") {
        parameters.set("append_to_response", "external_ids");
      }
      const payload = await request(
        `${validateMediaType(mediaType)}/${positiveId(tmdbId)}`,
        parameters,
        queryOptions.signal,
      );
      return parseCatalogDetails(payload, mediaType);
    },

    async season(tvTmdbId, seasonNumber, queryOptions = {}) {
      if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 0) {
        throw new TypeError("Season number must be a non-negative integer");
      }
      const payload = await request(
        `tv/${positiveId(tvTmdbId)}/season/${seasonNumber}`,
        languageParameters(queryOptions.language),
        queryOptions.signal,
      );
      return parseTvSeason(payload);
    },

    async genres(mediaType, queryOptions = {}) {
      const payload = await request(
        `genre/${validateMediaType(mediaType)}/list`,
        languageParameters(queryOptions.language),
        queryOptions.signal,
      );
      return parseGenres(payload);
    },

    async languages(signal) {
      const payload = await request(
        "configuration/languages",
        new URLSearchParams(),
        signal,
      );
      return parseLanguages(payload);
    },

    async countries(queryOptions = {}) {
      const payload = await request(
        "configuration/countries",
        languageParameters(queryOptions.language),
        queryOptions.signal,
      );
      return parseCountries(payload);
    },
  };
}

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("TMDB base URL must use HTTP or HTTPS");
  }
  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url;
}

function pageParameters(options: CatalogQueryOptions): URLSearchParams {
  const parameters = languageParameters(options.language);
  parameters.set("page", String(positivePage(options.page ?? 1)));
  if (options.region) {
    parameters.set("region", options.region);
  }
  return parameters;
}

function languageParameters(language?: string): URLSearchParams {
  const parameters = new URLSearchParams();
  if (language) {
    parameters.set("language", language);
  }
  return parameters;
}

function parseCatalogPage(
  value: unknown,
  knownMediaType?: CatalogMediaType,
): CatalogPage {
  if (!isRecord(value) || !Array.isArray(value["results"])) {
    throw new IntegrationError("tmdb", "TMDB returned an invalid result page");
  }
  const results: CatalogItem[] = [];
  for (const item of value["results"]) {
    const parsed = parseCatalogItem(item, knownMediaType, true);
    if (parsed) {
      results.push(parsed);
    }
  }
  return {
    page: boundedCatalogPage(value["page"]),
    totalPages: boundedCatalogPage(value["total_pages"]),
    totalResults: positiveOrZero(value["total_results"], results.length),
    results,
  };
}

function boundedCatalogPage(value: unknown): number {
  return Math.min(500, Math.max(1, Math.trunc(positiveOrZero(value, 1))));
}

function parseCatalogItem(
  value: unknown,
  knownMediaType?: CatalogMediaType,
  allowUnsupported = false,
): CatalogItem | null {
  if (!isRecord(value)) {
    if (allowUnsupported) return null;
    throw new IntegrationError("tmdb", "TMDB returned invalid media data");
  }
  const rawType = knownMediaType ?? asString(value["media_type"]);
  if (rawType !== "movie" && rawType !== "tv") {
    if (allowUnsupported) return null;
    throw new IntegrationError(
      "tmdb",
      "TMDB returned an unsupported media type",
    );
  }
  const tmdbId = asFiniteNumber(value["id"]);
  const title = asString(rawType === "movie" ? value["title"] : value["name"]);
  if (!tmdbId || !Number.isSafeInteger(tmdbId) || !title) {
    if (allowUnsupported) return null;
    throw new IntegrationError("tmdb", "TMDB media omitted its id or title");
  }
  const originalTitle =
    asString(
      rawType === "movie" ? value["original_title"] : value["original_name"],
    ) ?? title;
  const releaseDate = nullableString(
    rawType === "movie" ? value["release_date"] : value["first_air_date"],
  );
  return {
    mediaType: rawType,
    tmdbId,
    title,
    originalTitle,
    overview: asString(value["overview"]) ?? "",
    originalLanguage: asString(value["original_language"]) ?? "",
    releaseDate,
    year: releaseDate ? parseDateYear(releaseDate) : null,
    posterPath: nullableString(value["poster_path"]),
    backdropPath: nullableString(value["backdrop_path"]),
    genreIds: numberArray(value["genre_ids"]),
    popularity: asFiniteNumber(value["popularity"]) ?? 0,
    voteAverage: asFiniteNumber(value["vote_average"]) ?? 0,
    voteCount: positiveOrZero(value["vote_count"], 0),
  };
}

function parseCatalogDetails(
  value: unknown,
  mediaType: CatalogMediaType,
): CatalogDetails {
  const base = parseCatalogItem(value, mediaType);
  if (!base || !isRecord(value)) {
    throw new IntegrationError("tmdb", "TMDB returned invalid media details");
  }
  const genres = Array.isArray(value["genres"])
    ? value["genres"].flatMap((genre) => {
        if (!isRecord(genre)) return [];
        const id = asFiniteNumber(genre["id"]);
        const name = asString(genre["name"]);
        return id !== undefined && name ? [{ id, name }] : [];
      })
    : [];
  const externalIds = isRecord(value["external_ids"])
    ? value["external_ids"]
    : undefined;
  const externalId =
    nullableString(value["imdb_id"]) ??
    nullableString(externalIds?.["imdb_id"]) ??
    nullableString(value["external_id"]);
  return {
    ...base,
    genres,
    runtimeMinutes: nullableNumber(
      value[mediaType === "movie" ? "runtime" : "episode_run_time"],
    ),
    status: nullableString(value["status"]),
    tagline: nullableString(value["tagline"]),
    homepage: nullableString(value["homepage"]),
    externalId,
    numberOfSeasons:
      mediaType === "tv" ? nullableNumber(value["number_of_seasons"]) : null,
    numberOfEpisodes:
      mediaType === "tv" ? nullableNumber(value["number_of_episodes"]) : null,
  };
}

function parseTvSeason(value: unknown): TvSeason {
  if (!isRecord(value)) {
    throw new IntegrationError("tmdb", "TMDB returned invalid season data");
  }
  const tmdbId = asFiniteNumber(value["id"]);
  const seasonNumber = asFiniteNumber(value["season_number"]);
  const name = asString(value["name"]);
  if (
    tmdbId === undefined ||
    seasonNumber === undefined ||
    !Number.isSafeInteger(seasonNumber) ||
    !name
  ) {
    throw new IntegrationError("tmdb", "TMDB season omitted required fields");
  }
  const episodes = Array.isArray(value["episodes"])
    ? value["episodes"].map(parseTvEpisode)
    : [];
  return {
    tmdbId,
    name,
    overview: asString(value["overview"]) ?? "",
    airDate: nullableString(value["air_date"]),
    seasonNumber,
    posterPath: nullableString(value["poster_path"]),
    episodes,
  };
}

function parseTvEpisode(value: unknown): TvEpisode {
  if (!isRecord(value)) {
    throw new IntegrationError("tmdb", "TMDB returned invalid episode data");
  }
  const tmdbId = asFiniteNumber(value["id"]);
  const episodeNumber = asFiniteNumber(value["episode_number"]);
  const seasonNumber = asFiniteNumber(value["season_number"]);
  const name = asString(value["name"]);
  if (
    tmdbId === undefined ||
    episodeNumber === undefined ||
    seasonNumber === undefined ||
    !name
  ) {
    throw new IntegrationError("tmdb", "TMDB episode omitted required fields");
  }
  return {
    tmdbId,
    name,
    overview: asString(value["overview"]) ?? "",
    airDate: nullableString(value["air_date"]),
    episodeNumber,
    seasonNumber,
    runtimeMinutes: nullableNumber(value["runtime"]),
    stillPath: nullableString(value["still_path"]),
    voteAverage: asFiniteNumber(value["vote_average"]) ?? 0,
  };
}

function parseGenres(value: unknown): readonly CatalogGenre[] {
  if (!isRecord(value) || !Array.isArray(value["genres"])) {
    throw new IntegrationError("tmdb", "TMDB returned invalid genre data");
  }
  return value["genres"].flatMap((genre) => {
    if (!isRecord(genre)) return [];
    const id = asFiniteNumber(genre["id"]);
    const name = asString(genre["name"]);
    return id !== undefined && Number.isSafeInteger(id) && name
      ? [{ id, name }]
      : [];
  });
}

function parseLanguages(value: unknown): readonly CatalogLanguage[] {
  if (!Array.isArray(value)) {
    throw new IntegrationError("tmdb", "TMDB returned invalid language data");
  }
  return value
    .flatMap((language) => {
      if (!isRecord(language)) return [];
      const code = asString(language["iso_639_1"]);
      const englishName = asString(language["english_name"]);
      if (!code || !englishName) return [];
      return [
        {
          code,
          englishName,
          name: asString(language["name"]) ?? englishName,
        },
      ];
    })
    .sort((left, right) => left.englishName.localeCompare(right.englishName));
}

function parseCountries(value: unknown): readonly CatalogCountry[] {
  if (!Array.isArray(value)) {
    throw new IntegrationError("tmdb", "TMDB returned invalid country data");
  }
  return value
    .flatMap((country) => {
      if (!isRecord(country)) return [];
      const code = asString(country["iso_3166_1"]);
      const englishName = asString(country["english_name"]);
      if (!code || !englishName) return [];
      return [
        {
          code,
          englishName,
          nativeName: asString(country["native_name"]) ?? englishName,
        },
      ];
    })
    .sort((left, right) => left.englishName.localeCompare(right.englishName));
}

function validateMediaType(value: CatalogMediaType): CatalogMediaType {
  if (value !== "movie" && value !== "tv") {
    throw new TypeError("Unsupported catalog media type");
  }
  return value;
}

function positiveId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("TMDB id must be a positive integer");
  }
  return value;
}

function positivePage(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 500) {
    throw new TypeError("TMDB page must be an integer from 1 to 500");
  }
  return value;
}

function validYear(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1874 || value > 2200) {
    throw new TypeError("Year is outside the supported range");
  }
  return value;
}

function validGenres(values: readonly number[]): readonly number[] {
  if (values.length > 20) {
    throw new TypeError("Discover supports at most 20 genres");
  }
  const genres = [...new Set(values)];
  if (
    genres.some(
      (genre) => !Number.isSafeInteger(genre) || genre <= 0 || genre > 999_999,
    )
  ) {
    throw new TypeError("Genre ids must be positive integers");
  }
  return genres;
}

function validCountryCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    throw new TypeError("Origin country must be an ISO 3166-1 alpha-2 code");
  }
  return code;
}

function validLanguageCode(value: string): string {
  const code = value.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) {
    throw new TypeError("Original language must be an ISO 639-1 code");
  }
  return code;
}

function validDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new TypeError("Discover dates must use YYYY-MM-DD");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new TypeError("Discover date is invalid");
  }
  return value;
}

function validRuntime(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_440) {
    throw new TypeError("Runtime must be an integer from 0 to 1440 minutes");
  }
  return value;
}

function validVoteCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000) {
    throw new TypeError("Minimum vote count is outside the supported range");
  }
  return value;
}

function validRating(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 10) {
    throw new TypeError("Minimum rating must be between 0 and 10");
  }
  return value;
}

function normalizeDiscoverSort(
  mediaType: CatalogMediaType,
  value: DiscoverSort,
): string {
  const match = /^([a-z_]+)\.(asc|desc)$/.exec(value);
  const field = match?.[1];
  const direction = match?.[2];
  if (!field || !direction) throw new TypeError("Unsupported discover sort");
  if (["popularity", "vote_average", "vote_count"].includes(field)) {
    return `${field}.${direction}`;
  }
  if (
    ["release_date", "primary_release_date", "first_air_date"].includes(field)
  ) {
    return `${mediaType === "movie" ? "primary_release_date" : "first_air_date"}.${direction}`;
  }
  if (["title", "name"].includes(field)) {
    return `${mediaType === "movie" ? "title" : "name"}.${direction}`;
  }
  if (["original_title", "original_name"].includes(field)) {
    return `${mediaType === "movie" ? "original_title" : "original_name"}.${direction}`;
  }
  if (field === "revenue" && mediaType === "movie") {
    return `revenue.${direction}`;
  }
  throw new TypeError(`Sort ${value} is not supported for ${mediaType}`);
}

function numberArray(value: unknown): readonly number[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is number =>
          typeof item === "number" && Number.isFinite(item),
      )
    : [];
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  if (Array.isArray(value)) {
    const number = value.find(
      (item): item is number => typeof item === "number" && item > 0,
    );
    return number ?? null;
  }
  return asFiniteNumber(value) ?? null;
}

function positiveOrZero(value: unknown, fallback: number): number {
  const number = asFiniteNumber(value);
  return number !== undefined && number >= 0 ? number : fallback;
}

function parseDateYear(value: string): number | null {
  const match = /^(\d{4})-/.exec(value);
  return match?.[1] ? Number(match[1]) : null;
}
