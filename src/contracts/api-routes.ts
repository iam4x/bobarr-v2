import type {
  ActivityEvent,
  AppSettings,
  BackupRestoreStatus,
  CalendarItem,
  CatalogItem,
  Download,
  IntegrationStatus,
  Job,
  JobDetails,
  LibraryItem,
  MonitorPolicy,
  ReleaseCandidate,
  ScanReview,
  Session,
  SetupStatus,
  StagedRestore,
  SystemStatus,
} from "./client-models";

export const API_V1_PREFIX = "/api/v1" as const;

export interface ApiPageInfo {
  limit: number;
  offset: number;
  total: number;
}

/** Payload variants accepted by the web compatibility normalizer. */
export type ApiCollectionResponse<T> =
  | T[]
  | {
      items: T[];
      page?: number | ApiPageInfo;
      totalPages?: number;
      totalItems?: number;
    }
  | {
      results: T[];
      page?: number;
      total_pages?: number;
      total_results?: number;
    }
  | { downloads: T[]; page?: ApiPageInfo }
  | { jobs: T[]; page?: ApiPageInfo }
  | { events: T[]; page?: ApiPageInfo }
  | { candidates: T[]; page?: ApiPageInfo };

export interface CatalogApiPage {
  items: CatalogItem[];
  page: number;
  totalPages: number;
  totalItems: number;
  personalized?: boolean;
}

export interface DownloadsApiPage {
  downloads: Download[];
  page: ApiPageInfo;
}

export interface JobsApiPage {
  jobs: Job[];
  page: ApiPageInfo;
}

export interface JobsApiQuery extends PaginationQuery {
  status?: "queued" | "running" | "completed" | "failed" | "cancelled";
  kind?: string;
}

export interface ReleasesApiResponse {
  items: ReleaseCandidate[];
  expiresAt: string;
  query: string;
  mediaId: string | null;
  replacementRequired: boolean;
}

export interface ScanReviewsApiResponse {
  reviews: ScanReview[];
  page: ApiPageInfo;
}

export type IntegrationKey = "tmdb" | "jackett" | "transmission" | "omdb";
export type CatalogKind = "movie" | "series";
export type CatalogDiscoverSort =
  | "popularity.asc"
  | "popularity.desc"
  | "vote_average.asc"
  | "vote_average.desc"
  | "vote_count.asc"
  | "vote_count.desc"
  | "release_date.asc"
  | "release_date.desc"
  | "primary_release_date.asc"
  | "primary_release_date.desc"
  | "first_air_date.asc"
  | "first_air_date.desc"
  | "title.asc"
  | "title.desc"
  | "name.asc"
  | "name.desc"
  | "original_title.asc"
  | "original_title.desc"
  | "original_name.asc"
  | "original_name.desc"
  | "revenue.asc"
  | "revenue.desc";

export interface CatalogDiscoverQuery {
  kind?: CatalogKind;
  sort?: CatalogDiscoverSort;
  page?: number;
  /** Comma-separated TMDB genre ids. Multiple ids match any selected genre. */
  genres?: string;
  originCountry?: string;
  originalLanguage?: string;
  year?: number;
  dateFrom?: string;
  dateTo?: string;
  runtimeMin?: number;
  runtimeMax?: number;
  voteCountMin?: number;
  ratingMin?: number;
}

export type MonitorMediaInput =
  | {
      tmdbId: number;
      kind: "movie";
      monitorPolicy: MonitorPolicy;
      seasonNumbers?: never;
      includeFutureSeasons?: never;
    }
  | {
      tmdbId: number;
      kind: "series";
      monitorPolicy: MonitorPolicy;
      seasonNumbers?: number[];
      includeFutureSeasons?: boolean;
    };

export interface MonitorMediaPatch {
  monitorPolicy: MonitorPolicy;
  seasonNumbers?: number[];
  includeFutureSeasons?: boolean;
}

export interface LibraryRemovalInput {
  deleteLibraryFiles?: boolean;
  deleteTorrent?: boolean;
  deleteDownloadData?: boolean;
}

export type DownloadCreateInput =
  | FormData
  | {
      candidateId?: string;
      magnet?: string;
      paused?: boolean;
      peerLimit?: number;
    };

export interface DownloadFilesInput {
  wanted?: number[];
  unwanted?: number[];
  priorityHigh?: number[];
  priorityNormal?: number[];
  priorityLow?: number[];
}

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface ApiRoute<
  TMethod extends HttpMethod,
  TPath extends string,
  TResponse,
  TQuery = never,
  TBody = never,
  THeaders = never,
> {
  readonly method: TMethod;
  readonly path: TPath;
  readonly __types?: {
    response: TResponse;
    query: TQuery;
    body: TBody;
    headers: THeaders;
  };
}

function route<TResponse, TQuery = never, TBody = never, THeaders = never>() {
  return <const TMethod extends HttpMethod, const TPath extends string>(
    method: TMethod,
    path: TPath,
  ): ApiRoute<TMethod, TPath, TResponse, TQuery, TBody, THeaders> => ({
    method,
    path,
  });
}

type PaginationQuery = {
  limit?: number;
  offset?: number;
};

export const apiRoutes = {
  setupStatus: route<SetupStatus>()("GET", "/setup/status"),
  setup: route<Session, never, { username: string; password: string }>()(
    "POST",
    "/setup",
  ),
  login: route<Session, never, { username: string; password: string }>()(
    "POST",
    "/auth/login",
  ),
  currentSession: route<Session>()("GET", "/auth/me"),
  logout: route<{ loggedOut: true }>()("POST", "/auth/logout"),
  getSettings: route<AppSettings>()("GET", "/settings"),
  updateSettings: route<AppSettings, never, Partial<AppSettings>>()(
    "PATCH",
    "/settings",
  ),
  systemStatus: route<SystemStatus>()("GET", "/system"),
  listLibrary: route<
    ApiCollectionResponse<LibraryItem>,
    | (PaginationQuery & {
        status?: string;
        kind?: "movie" | "series" | "season" | "episode";
        parentId?: string;
        monitorPolicy?: MonitorPolicy;
      })
    | undefined
  >()("GET", "/library"),
  monitorMedia: route<LibraryItem, never, MonitorMediaInput>()(
    "POST",
    "/library",
  ),
  updateMonitoring: route<LibraryItem, never, MonitorMediaPatch>()(
    "PATCH",
    "/library/:id",
  ),
  retryLibraryItem: route<{
    accepted: true;
    jobId: string | null;
    jobIds?: string[];
  }>()("POST", "/library/:id/retry"),
  replaceLibraryItem: route<
    { accepted: true; downloadId: string | null; jobIds: string[] },
    never,
    { candidateId?: string } | undefined
  >()("POST", "/library/:id/replace"),
  scanLibrary: route<
    { accepted: true; jobId: string },
    never,
    { kind?: CatalogKind } | undefined
  >()("POST", "/library/scan"),
  removeLibraryItem: route<
    {
      deleted: boolean;
      monitoringStopped: boolean;
      libraryFilesDeleted: boolean;
      torrentDeleted: boolean;
      downloadDataDeleted: boolean;
    },
    never,
    LibraryRemovalInput | undefined
  >()("DELETE", "/library/:id"),
  listScanReviews: route<
    ScanReviewsApiResponse,
    PaginationQuery & {
      status?: "pending" | "resolved" | "dismissed";
      kind?: CatalogKind;
    }
  >()("GET", "/library/scan-reviews"),
  resolveScanReview: route<ScanReview, never, { tmdbId: number }>()(
    "POST",
    "/library/scan-reviews/:id/resolve",
  ),
  dismissScanReview: route<{ dismissed: true; review: ScanReview }>()(
    "POST",
    "/library/scan-reviews/:id/dismiss",
  ),
  catalogSearch: route<
    CatalogApiPage,
    { query: string; kind?: CatalogKind; page?: number }
  >()("GET", "/catalog/search"),
  catalogDiscover: route<CatalogApiPage, CatalogDiscoverQuery>()(
    "GET",
    "/catalog/discover",
  ),
  catalogGenres: route<
    { items: Array<{ id: number; name: string }> },
    { kind?: CatalogKind } | undefined
  >()("GET", "/catalog/genres"),
  catalogLanguages: route<{
    items: Array<{ code: string; englishName: string; name: string }>;
  }>()("GET", "/catalog/languages"),
  catalogCountries: route<{
    items: Array<{ code: string; englishName: string; nativeName: string }>;
  }>()("GET", "/catalog/countries"),
  catalogRecommendations: route<CatalogApiPage>()(
    "GET",
    "/catalog/recommendations",
  ),
  catalogDetails: route<CatalogItem>()("GET", "/catalog/:kind/:tmdbId"),
  searchReleases: route<
    ReleasesApiResponse,
    {
      tmdbId: number;
      kind: CatalogKind;
      season?: number;
      episode?: number;
      query?: string;
    }
  >()("GET", "/releases"),
  listDownloads: route<
    DownloadsApiPage,
    | (PaginationQuery & {
        state?: string;
        mediaId?: string;
      })
    | undefined
  >()("GET", "/downloads"),
  createDownload: route<Download, never, DownloadCreateInput>()(
    "POST",
    "/downloads",
  ),
  pauseDownload: route<Download>()("POST", "/downloads/:id/pause"),
  resumeDownload: route<Download>()("POST", "/downloads/:id/resume"),
  retryDownload: route<Download>()("POST", "/downloads/:id/retry"),
  selectDownloadFiles: route<{ updated: boolean }, never, DownloadFilesInput>()(
    "PATCH",
    "/downloads/:id/files",
  ),
  removeDownload: route<
    { removed: boolean; dataDeleted: boolean },
    never,
    { deleteData?: boolean } | undefined
  >()("DELETE", "/downloads/:id"),
  listJobs: route<JobsApiPage, JobsApiQuery | undefined>()("GET", "/jobs"),
  createJob: route<
    Job,
    never,
    { kind: string; payload?: Record<string, unknown> }
  >()("POST", "/jobs"),
  getJob: route<JobDetails>()("GET", "/jobs/:id"),
  retryJob: route<Job>()("POST", "/jobs/:id/retry"),
  cancelJob: route<{ id: string; cancelled: true }>()("DELETE", "/jobs/:id"),
  calendar: route<
    ApiCollectionResponse<CalendarItem>,
    { from: string; to: string }
  >()("GET", "/calendar"),
  activity: route<
    ApiCollectionResponse<ActivityEvent>,
    PaginationQuery | undefined
  >()("GET", "/system/activity"),
  testIntegration: route<IntegrationStatus>()(
    "POST",
    "/settings/integrations/:key/test",
  ),
  validateStorage: route<
    { valid: boolean; message?: string },
    never,
    AppSettings["storage"]
  >()("POST", "/settings/storage/validate"),
  createBackup: route<{ completed: boolean; result: unknown }>()(
    "POST",
    "/system/backups",
  ),
  listBackups: route<BackupRestoreStatus>()("GET", "/system/backups"),
  stageRestore: route<
    StagedRestore,
    never,
    Blob,
    { "x-bobarr-restore-confirmation": "stage-restore" }
  >()("POST", "/system/restore"),
} as const;

export type ApiRoutes = typeof apiRoutes;
export type ApiRouteName = keyof ApiRoutes;
export type ApiRouteFor<TName extends ApiRouteName> = ApiRoutes[TName];
export type ApiRouteMethod<TName extends ApiRouteName> =
  ApiRouteFor<TName>["method"];
export type ApiRouteResponse<TName extends ApiRouteName> = NonNullable<
  ApiRouteFor<TName>["__types"]
>["response"];
export type ApiRouteQuery<TName extends ApiRouteName> = NonNullable<
  ApiRouteFor<TName>["__types"]
>["query"];
export type ApiRouteBody<TName extends ApiRouteName> = NonNullable<
  ApiRouteFor<TName>["__types"]
>["body"];
export type ApiRouteHeaders<TName extends ApiRouteName> = NonNullable<
  ApiRouteFor<TName>["__types"]
>["headers"];

export type ApiRouteNamesFor<TMethod extends HttpMethod> = {
  [TName in ApiRouteName]: ApiRouteMethod<TName> extends TMethod
    ? TName
    : never;
}[ApiRouteName];

type PathParameterNames<TPath extends string> =
  TPath extends `${string}:${infer TParameter}/${infer TRest}`
    ? TParameter | PathParameterNames<`/${TRest}`>
    : TPath extends `${string}:${infer TParameter}`
      ? TParameter
      : never;

export type ApiRouteParams<TName extends ApiRouteName> = Record<
  PathParameterNames<ApiRouteFor<TName>["path"]>,
  string | number
>;

export function apiPath<TName extends ApiRouteName>(
  name: TName,
  params?: Partial<ApiRouteParams<TName>>,
): string {
  let path: string = apiRoutes[name].path;
  path = path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_match, key: string) => {
    const value = params?.[key as keyof ApiRouteParams<TName>];
    if (value === undefined || value === null || value === "") {
      throw new TypeError(`Missing API path parameter: ${key}`);
    }
    return encodeURIComponent(String(value));
  });
  return `${API_V1_PREFIX}${path}`;
}
