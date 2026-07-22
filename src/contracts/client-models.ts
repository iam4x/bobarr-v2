/**
 * Stable models consumed by the web application.
 *
 * A few of these intentionally tolerate both the greenfield REST payloads and
 * the starter payloads handled by `src/web/api/normalize.ts`. Keeping that
 * compatibility at the edge lets the route contract remain strict without
 * spreading fallback shapes through UI components.
 */
export type MediaKind = "movie" | "series" | "season" | "episode";
export type MonitorPolicy = "none" | "selected" | "all" | "future";
export type AcquisitionState =
  | "unmonitored"
  | "missing"
  | "searching"
  | "queued"
  | "downloading"
  | "organizing"
  | "available"
  | "failed";
export type DownloadState =
  | "queued"
  | "downloading"
  | "paused"
  | "checking"
  | "seeding"
  | "organizing"
  | "completed"
  | "failed";
export type OrganizationStrategy = "hardlink" | "symlink" | "copy" | "move";

export interface Session {
  authenticated?: boolean;
  administrator?: {
    id: string | number;
    username: string;
  };
  admin?: {
    id: string | number;
    username: string;
  };
  csrfToken?: string;
  expiresAt?: string;
}

export interface SetupStatus {
  required?: boolean;
  setupRequired?: boolean;
}

export interface CatalogItem {
  id: string;
  tmdbId: number;
  kind: "movie" | "series";
  title: string;
  originalTitle?: string;
  overview: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  releaseDate?: string | null;
  year?: number | null;
  voteAverage?: number | null;
  genres?: Array<{ id: number; name: string }>;
  numberOfSeasons?: number | null;
  monitoredSeasonNumbers?: number[];
  ratings?: {
    imdb: {
      value: number;
      scale: 10;
      votes: number | null;
    } | null;
    rottenTomatoes: {
      value: number;
      scale: 100;
    } | null;
  };
  monitored?: boolean;
  acquisitionState?: AcquisitionState;
}

export interface CatalogPage {
  items: CatalogItem[];
  page: number;
  totalPages: number;
  totalItems?: number;
  personalized?: boolean;
}

export interface LibraryItem extends Omit<CatalogItem, "kind" | "tmdbId"> {
  tmdbId: number | null;
  kind: MediaKind;
  parentId?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  monitorPolicy: MonitorPolicy;
  acquisitionState: AcquisitionState;
  metadata?: Record<string, unknown>;
  addedAt?: string;
  nextAirDate?: string | null;
  episodeProgress?: {
    available: number;
    total: number;
  };
}

export interface ScanReviewCandidate {
  tmdbId: number;
  kind: "movie" | "series";
  title: string;
  year: number | null;
  posterPath: string | null;
  overview: string;
}

export interface ScanReview {
  id: string;
  kind: "movie" | "series";
  title: string;
  year: number | null;
  rootPath: string;
  files: Array<{ path: string; sizeBytes: number }>;
  candidates: ScanReviewCandidate[];
  status: "pending" | "resolved" | "dismissed";
  resolvedTmdbId: number | null;
  mediaItemId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface CalendarItem {
  id: string;
  mediaId: string;
  kind: "movie" | "episode";
  title: string;
  subtitle?: string;
  airDate: string;
  posterPath?: string | null;
  acquisitionState: AcquisitionState;
}

export interface Download {
  id: string;
  mediaId?: string | null;
  title: string;
  state: DownloadState;
  progress: number;
  downloadedBytes?: number;
  totalBytes?: number;
  downloadRate?: number;
  uploadRate?: number;
  etaSeconds?: number | null;
  error?: string | null;
  createdAt?: string;
  files?: Array<{
    index: number;
    name: string;
    length: number;
    bytesCompleted: number;
    wanted: boolean;
    priority: "low" | "normal" | "high";
  }>;
}

export interface Job {
  id: string;
  type: string;
  state:
    | "pending"
    | "running"
    | "retrying"
    | "completed"
    | "failed"
    | "cancelled";
  attempts: number;
  maxAttempts: number;
  runAt: string;
  error?: string | null;
  payload?: Record<string, unknown>;
  priority?: number;
  dedupeKey?: string | null;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface JobLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  event: string;
  message: string | null;
}

export interface JobDetails extends Job {
  logs: JobLogEntry[];
}

export interface ActivityEvent {
  id: string;
  type: string;
  message: string;
  level: "info" | "success" | "warning" | "error";
  createdAt: string;
}

export interface IntegrationStatus {
  key: "tmdb" | "jackett" | "transmission" | "omdb" | string;
  label: string;
  configured: boolean;
  healthy: boolean;
  message?: string;
  version?: string;
}

export interface SystemStatus {
  status: "ready" | "degraded" | "unavailable";
  version?: string;
  integrations: IntegrationStatus[];
}

export interface VerifiedBackup {
  name: string;
  sizeBytes: number;
  createdAt: string;
  migrationVersion: number;
  sha256: string;
  verified: true;
}

export interface StagedRestore {
  sizeBytes: number;
  stagedAt: string;
  migrationVersion: number;
  sha256: string;
  restartRequired: true;
}

export interface BackupRestoreStatus {
  backups: VerifiedBackup[];
  stagedRestore: StagedRestore | null;
  maxUploadBytes: number;
}

export interface AppSettings {
  locale: {
    language: string;
    region: string;
  };
  integrations: {
    tmdbApiKey?: string;
    omdbApiKey?: string;
    jackettUrl: string;
    jackettApiKey?: string;
    transmissionUrl: string;
    transmissionUsername?: string;
    transmissionPassword?: string;
  };
  acquisition: {
    minimumSeeders: number;
    minimumSizeMb?: number | null;
    maximumSizeMb?: number | null;
    requiredTerms: string[];
    preferredTerms: string[];
    rejectedTerms: string[];
    qualityOrder: string[];
  };
  storage: {
    downloadsPath: string;
    moviesPath: string;
    televisionPath: string;
    organizationStrategy: OrganizationStrategy;
  };
  schedules: {
    searchMissing: string;
    refreshMetadata: string;
    scanLibrary: string;
    backup: string;
    backupRetention: number;
  };
}

export interface ReleaseCandidate {
  id: string;
  mediaId?: string | null;
  title: string;
  indexer: string;
  size: number;
  seeders: number;
  leechers?: number;
  publishedAt?: string;
  quality?: string;
  score: number;
  eligible: boolean;
  reasons: string[];
  scoreExplanation?: Array<{ label: string; value: number }>;
}
