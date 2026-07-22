import type {
  ActivityEvent,
  CalendarItem,
  CatalogItem,
  CatalogPage,
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

function normalizeLibraryItem(value: UnknownRecord): UnknownRecord {
  if (!("monitorPolicy" in value)) return value;
  const metadata = isRecord(value["metadata"]) ? value["metadata"] : undefined;
  const posterUrl = recordString(value, "posterUrl");
  const acquisitionState =
    recordString(value, "acquisitionState") ?? recordString(value, "status");

  return {
    overview: recordString(metadata, "overview") ?? "",
    originalTitle: recordString(metadata, "originalTitle"),
    backdropPath:
      recordString(metadata, "backdropPath") ??
      recordString(metadata, "backdropUrl"),
    ...value,
    posterPath: recordString(value, "posterPath") ?? posterUrl ?? null,
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
