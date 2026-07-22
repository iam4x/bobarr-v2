import {
  IntegrationError,
  type FetchLike,
  asString,
  isRecord,
  parseJsonResponse,
  requestSignal,
} from "./http";

const DEFAULT_BASE_URL = "https://www.omdbapi.com/";
const DEFAULT_TIMEOUT_MS = 8_000;

export interface OmdbScore<TScale extends 10 | 100> {
  value: number;
  scale: TScale;
}

export interface OmdbRatings {
  imdbId: string;
  imdb: (OmdbScore<10> & { votes: number | null }) | null;
  rottenTomatoes: OmdbScore<100> | null;
}

export interface OmdbClient {
  ratings(imdbId: string, signal?: AbortSignal): Promise<OmdbRatings>;
  health(signal?: AbortSignal): Promise<void>;
}

export interface OmdbClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export function createOmdbClient(options: OmdbClientOptions): OmdbClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new TypeError("An OMDb API key is required");

  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function ratings(
    rawImdbId: string,
    signal?: AbortSignal,
  ): Promise<OmdbRatings> {
    const imdbId = validateImdbId(rawImdbId);
    const url = new URL(baseUrl);
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("i", imdbId);
    url.searchParams.set("plot", "short");
    url.searchParams.set("r", "json");

    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { accept: "application/json" },
        signal: requestSignal(timeoutMs, signal),
      });
    } catch (error) {
      throw new IntegrationError("omdb", "OMDb request failed", {
        cause: redactedCause(error, apiKey),
        retryable: true,
      });
    }

    const payload = await parseJsonResponse("omdb", response);
    if (!response.ok) {
      throw new IntegrationError(
        "omdb",
        `OMDb returned HTTP ${response.status}`,
        {
          status: response.status,
          retryable: response.status === 429 || response.status >= 500,
        },
      );
    }
    if (!isRecord(payload)) {
      throw new IntegrationError("omdb", "OMDb returned invalid media data");
    }
    if (payload["Response"] !== "True") {
      const upstreamMessage = asString(payload["Error"]);
      throw new IntegrationError(
        "omdb",
        upstreamMessage
          ? redact(upstreamMessage, apiKey)
          : "OMDb rejected the request",
      );
    }

    const responseImdbId = asString(payload["imdbID"]);
    if (responseImdbId !== undefined && responseImdbId !== imdbId) {
      throw new IntegrationError(
        "omdb",
        "OMDb returned ratings for an unexpected title",
      );
    }

    const listedRatings = Array.isArray(payload["Ratings"])
      ? payload["Ratings"]
      : [];
    const imdbValue =
      boundedNumber(asString(payload["imdbRating"]), 10) ??
      ratingValue(listedRatings, "Internet Movie Database", 10);
    const rottenTomatoesValue = ratingValue(
      listedRatings,
      "Rotten Tomatoes",
      100,
    );

    return {
      imdbId,
      imdb:
        imdbValue === undefined
          ? null
          : {
              value: imdbValue,
              scale: 10,
              votes: parseVotes(asString(payload["imdbVotes"])),
            },
      rottenTomatoes:
        rottenTomatoesValue === undefined
          ? null
          : { value: rottenTomatoesValue, scale: 100 },
    };
  }

  return {
    ratings,
    async health(signal) {
      await ratings("tt0111161", signal);
    },
  };
}

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("OMDb base URL must use HTTP or HTTPS");
  }
  return url;
}

function validateImdbId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^tt\d{7,12}$/.test(normalized)) {
    throw new TypeError("IMDb id must use the tt1234567 format");
  }
  return normalized;
}

function ratingValue(
  ratings: readonly unknown[],
  source: string,
  scale: 10 | 100,
): number | undefined {
  for (const rating of ratings) {
    if (!isRecord(rating) || rating["Source"] !== source) continue;
    const raw = asString(rating["Value"])?.split("/")[0]?.replace("%", "");
    return boundedNumber(raw, scale);
  }
  return undefined;
}

function boundedNumber(
  value: string | undefined,
  scale: 10 | 100,
): number | undefined {
  if (!value || value === "N/A") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= scale
    ? parsed
    : undefined;
}

function parseVotes(value: string | undefined): number | null {
  if (!value || value === "N/A") return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function redactedCause(error: unknown, secret: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(redact(message, secret));
}

function redact(value: string, secret: string): string {
  return secret ? value.replaceAll(secret, "[REDACTED]") : value;
}
