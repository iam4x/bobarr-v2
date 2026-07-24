import type {
  ActivityEvent,
  CalendarItem,
  CatalogItem,
  CatalogPage,
  CatalogRecommendationGroup,
  CatalogRecommendationsResponse,
  Download,
  Job,
  LibraryItem,
  ReleaseCandidate,
  Session,
  SetupStatus,
  SystemStatus,
} from "../types";

interface PageInfo {
  limit: number;
  offset: number;
  total: number;
}

type CollectionResponse<T> =
  | T[]
  | {
      items: T[];
      page?: number | PageInfo;
      totalPages?: number;
      totalItems?: number;
    }
  | {
      results: T[];
      page?: number;
      total_pages?: number;
      total_results?: number;
    }
  | { downloads: T[]; page?: PageInfo }
  | { jobs: T[]; page?: PageInfo }
  | { events: T[]; page?: PageInfo }
  | { candidates: T[]; page?: PageInfo };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function recordString(
  record: UnknownRecord | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function recordNumber(
  record: UnknownRecord | undefined,
  key: string,
): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function recordGenres(
  record: UnknownRecord | undefined,
  key: string,
): Array<{ id: number; name: string }> | undefined {
  const value = record?.[key];
  if (!Array.isArray(value)) return undefined;
  const genres = value.flatMap((genre) => {
    if (!isRecord(genre)) return [];
    const id = recordNumber(genre, "id");
    const name = recordString(genre, "name");
    return id === undefined || name === undefined ? [] : [{ id, name }];
  });
  return genres.length > 0 ? genres : undefined;
}

function normalizeLibraryItem(value: UnknownRecord): UnknownRecord {
  if (!("monitorPolicy" in value)) return value;
  const metadata = isRecord(value["metadata"]) ? value["metadata"] : undefined;
  const rating = isRecord(value["rating"]) ? value["rating"] : undefined;
  const posterUrl = recordString(value, "posterUrl");
  const acquisitionState =
    recordString(value, "acquisitionState") ?? recordString(value, "status");
  const voteAverage =
    recordNumber(value, "voteAverage") ??
    recordNumber(metadata, "voteAverage") ??
    recordNumber(rating, "value");
  const genres =
    recordGenres(value, "genres") ?? recordGenres(metadata, "genres");
  const numberOfSeasons =
    recordNumber(value, "numberOfSeasons") ??
    recordNumber(metadata, "numberOfSeasons");

  return {
    overview: recordString(metadata, "overview") ?? "",
    originalTitle: recordString(metadata, "originalTitle"),
    backdropPath:
      recordString(metadata, "backdropPath") ??
      recordString(metadata, "backdropUrl"),
    ...value,
    posterPath: recordString(value, "posterPath") ?? posterUrl ?? null,
    ...(voteAverage === undefined ? {} : { voteAverage }),
    ...(genres === undefined ? {} : { genres }),
    ...(numberOfSeasons === undefined ? {} : { numberOfSeasons }),
    addedAt: recordString(value, "addedAt") ?? recordString(value, "createdAt"),
    ...(acquisitionState === undefined ? {} : { acquisitionState }),
  };
}

function normalizeCalendarItem(value: UnknownRecord): UnknownRecord {
  const scheduledAt = recordString(value, "scheduledAt");
  if (scheduledAt === undefined) return value;

  const metadata = isRecord(value["metadata"]) ? value["metadata"] : undefined;
  const status = recordString(value, "status");
  const metadataKind =
    recordString(metadata, "mediaKind") ?? recordString(metadata, "kind");
  let statusState = "missing";
  if (status === "completed") statusState = "available";
  else if (status === "cancelled") statusState = "unmonitored";
  const acquisitionState =
    recordString(value, "acquisitionState") ??
    recordString(metadata, "acquisitionState") ??
    statusState;

  return {
    ...value,
    mediaId:
      recordString(value, "mediaId") ??
      recordString(value, "libraryItemId") ??
      recordString(value, "id"),
    kind: metadataKind === "movie" ? "movie" : "episode",
    airDate: scheduledAt,
    subtitle:
      recordString(value, "subtitle") ?? recordString(metadata, "subtitle"),
    posterPath:
      recordString(value, "posterPath") ??
      recordString(metadata, "posterPath") ??
      recordString(metadata, "posterUrl") ??
      null,
    acquisitionState,
  };
}

function normalizeJob(value: UnknownRecord): UnknownRecord {
  const kind = recordString(value, "kind");
  const status = recordString(value, "status");
  if (
    kind === undefined ||
    status === undefined ||
    (!("payload" in value) && !("progress" in value))
  ) {
    return value;
  }

  const errorDetails = isRecord(value["error"]) ? value["error"] : undefined;
  const state = status === "queued" ? "pending" : status;
  const attempts =
    recordNumber(value, "attempts") ??
    recordNumber(errorDetails, "attempt") ??
    (recordString(value, "startedAt") ? 1 : 0);
  const maxAttempts =
    recordNumber(value, "maxAttempts") ??
    recordNumber(errorDetails, "maxAttempts") ??
    5;

  return {
    ...value,
    type: recordString(value, "type") ?? kind,
    state,
    attempts,
    maxAttempts,
    runAt:
      recordString(value, "runAt") ??
      recordString(value, "startedAt") ??
      recordString(value, "createdAt"),
    error:
      recordString(errorDetails, "message") ??
      recordString(value, "message") ??
      null,
  };
}

export function normalizeJobDetails<T>(value: T): T {
  return isRecord(value) ? (normalizeJob(value) as T) : value;
}

function normalizeRelease(value: UnknownRecord): UnknownRecord {
  if (!("eligible" in value) || !("sizeBytes" in value)) return value;
  return {
    ...value,
    size: recordNumber(value, "size") ?? recordNumber(value, "sizeBytes") ?? 0,
    reasons: Array.isArray(value["reasons"]) ? value["reasons"] : [],
  };
}

function normalizeCollectionItem<T>(item: T): T {
  if (!isRecord(item)) return item;
  const normalized = normalizeRelease(
    normalizeJob(normalizeCalendarItem(normalizeLibraryItem(item))),
  );
  return normalized as T;
}

function responseItems<T>(response: CollectionResponse<T>): T[] {
  if (Array.isArray(response)) return response;
  if ("items" in response) return response.items;
  if ("results" in response) return response.results;
  if ("downloads" in response) return response.downloads;
  if ("jobs" in response) return response.jobs;
  if ("events" in response) return response.events;
  return response.candidates;
}

export function collectionItems<T>(
  response: CollectionResponse<T> | undefined,
): T[] {
  if (!response) return [];
  return responseItems(response).map(normalizeCollectionItem);
}

export function catalogPage(
  response: CollectionResponse<CatalogItem>,
): CatalogPage {
  if (Array.isArray(response)) {
    return {
      items: response.map(normalizeCollectionItem),
      page: 1,
      totalPages: 1,
      totalItems: response.length,
    };
  }
  if ("items" in response) {
    return {
      items: response.items.map(normalizeCollectionItem),
      page: typeof response.page === "number" ? response.page : 1,
      totalPages: response.totalPages ?? 1,
      totalItems: response.totalItems,
    };
  }
  if ("results" in response) {
    return {
      items: response.results.map(normalizeCollectionItem),
      page: response.page ?? 1,
      totalPages: response.total_pages ?? 1,
      totalItems: response.total_results,
    };
  }
  const items = responseItems(response).map(normalizeCollectionItem);
  return { items, page: 1, totalPages: 1, totalItems: items.length };
}

function normalizedCatalogItems(value: unknown): CatalogItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const kind = recordString(item, "kind");
    const tmdbId = recordNumber(item, "tmdbId");
    const title = recordString(item, "title");
    if (
      (kind !== "movie" && kind !== "series") ||
      tmdbId === undefined ||
      tmdbId <= 0 ||
      title === undefined
    ) {
      return [];
    }
    return [
      normalizeCollectionItem({
        ...item,
        id: recordString(item, "id") ?? `${kind}:${tmdbId}`,
        overview: recordString(item, "overview") ?? "",
        kind,
        tmdbId,
        title,
      } as CatalogItem),
    ];
  });
}

function normalizedRecommendationSource(
  value: unknown,
): CatalogRecommendationGroup["source"] | undefined {
  if (!isRecord(value)) return undefined;
  const kind = recordString(value, "kind");
  const tmdbId = recordNumber(value, "tmdbId");
  const title = recordString(value, "title");
  if (
    (kind !== "movie" && kind !== "series") ||
    tmdbId === undefined ||
    tmdbId <= 0 ||
    title === undefined
  ) {
    return undefined;
  }
  return {
    id: recordString(value, "id") ?? `library:${kind}:${tmdbId}`,
    tmdbId,
    kind,
    title,
    year: recordNumber(value, "year") ?? null,
    posterUrl:
      recordString(value, "posterUrl") ??
      recordString(value, "posterPath") ??
      null,
  };
}

function normalizedRecommendationGroups(value: unknown): {
  groups: CatalogRecommendationGroup[];
  groupedPayload: boolean;
} {
  if (!Array.isArray(value)) return { groups: [], groupedPayload: false };
  const groups = value.flatMap((group) => {
    if (!isRecord(group)) return [];
    const source = normalizedRecommendationSource(group["source"]);
    const items = normalizedCatalogItems(
      group["items"] ?? group["recommendations"],
    );
    return source && items.length > 0 ? [{ source, items }] : [];
  });
  return { groups, groupedPayload: true };
}

function legacyRecommendationGroups(
  value: UnknownRecord,
): CatalogRecommendationGroup[] {
  const items = normalizedCatalogItems(value["items"] ?? value["results"]);
  return (["movie", "series"] as const).flatMap((kind) => {
    const kindItems = items.filter((item) => item.kind === kind);
    if (kindItems.length === 0) return [];
    return [
      {
        source: {
          id: `legacy-library-mix:${kind}`,
          tmdbId: kind === "movie" ? 1 : 2,
          kind,
          title: kind === "movie" ? "Your movie library" : "Your TV library",
          year: null,
          posterUrl: null,
        },
        items: kindItems,
      },
    ];
  });
}

/**
 * Accepts both the grouped recommendation contract and the pre-grouping flat
 * catalog page. This keeps a rolling frontend/backend deployment or a hot
 * React Query cache from crashing the Suggestions route.
 */
export function normalizeCatalogRecommendations(
  value: unknown,
): CatalogRecommendationsResponse {
  if (!isRecord(value)) {
    return {
      groups: [],
      items: [],
      page: 1,
      totalPages: 1,
      personalized: false,
      totalItems: 0,
      sourceTotal: 0,
      nextCursor: null,
    };
  }
  const normalized = normalizedRecommendationGroups(value["groups"]);
  const groups = normalized.groupedPayload
    ? normalized.groups
    : legacyRecommendationGroups(value);
  const totalItems = groups.reduce(
    (total, group) => total + group.items.length,
    0,
  );
  const items = groups.flatMap((group) => group.items);
  const nextCursor = recordNumber(value, "nextCursor");
  return {
    groups,
    items,
    page: 1,
    totalPages: 1,
    personalized:
      normalized.groupedPayload &&
      value["personalized"] === true &&
      groups.length > 0,
    totalItems,
    sourceTotal:
      recordNumber(value, "sourceTotal") ??
      (normalized.groupedPayload ? groups.length : 0),
    nextCursor:
      normalized.groupedPayload &&
      nextCursor !== undefined &&
      Number.isSafeInteger(nextCursor) &&
      nextCursor >= 0
        ? nextCursor
        : null,
  };
}

export type CatalogResponse = CollectionResponse<CatalogItem>;
export type LibraryResponse = CollectionResponse<LibraryItem>;
export type CalendarResponse = CollectionResponse<CalendarItem>;
export type DownloadsResponse = CollectionResponse<Download>;
export type JobsResponse = CollectionResponse<Job>;
export type ActivityResponse = CollectionResponse<ActivityEvent>;
export type ReleasesResponse = CollectionResponse<ReleaseCandidate>;

export function isSetupRequired(status?: SetupStatus): boolean {
  return status?.required ?? status?.setupRequired ?? false;
}

export function isAuthenticated(session?: Session): boolean {
  return (
    session?.authenticated ?? Boolean(session?.administrator ?? session?.admin)
  );
}

export function normalizeSystemStatus(value: unknown): SystemStatus {
  if (
    value &&
    typeof value === "object" &&
    "status" in value &&
    "integrations" in value
  ) {
    return value as SystemStatus;
  }
  if (value && typeof value === "object" && "database" in value) {
    const foundation = value as {
      database?: { healthy?: boolean };
      version?: string;
    };
    return {
      status: foundation.database?.healthy ? "ready" : "degraded",
      version: foundation.version,
      integrations: [],
    };
  }
  return { status: "unavailable", integrations: [] };
}
