import type {
  ReleaseFacts,
  ReleaseProfile,
  ReleaseTarget,
} from "../domain/releases";
import type {
  CatalogDetails,
  CatalogCountry,
  CatalogGenre,
  CatalogItem,
  CatalogLanguage,
  CatalogMediaType,
  CatalogPage,
  CatalogQueryOptions,
  DiscoverOptions,
  TvSeason,
} from "../integrations/tmdb";
import type { JobQueue } from "../jobs";

export interface MetadataProvider {
  search(query: string, options?: CatalogQueryOptions): Promise<CatalogPage>;
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

export type { CatalogItem };

export interface IndexerSearchRequest {
  query: string;
  type?: "search" | "movie" | "tvsearch";
  categories?: readonly number[];
  tmdbId?: number;
  imdbId?: string;
  tvdbId?: number;
  season?: number;
  episode?: number;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export interface IndexerRelease {
  id: string;
  title: string;
  indexer: string | null;
  description: string | null;
  publishedAt: string | null;
  sizeBytes: number;
  seeders: number;
  peers: number;
  grabs: number;
  categories: readonly number[];
  downloadUrl: string | null;
  magnetUri: string | null;
  infoHash: string | null;
}

export interface IndexerSearchPage {
  offset: number;
  total: number;
  results: readonly IndexerRelease[];
}

export interface IndexerGateway {
  search(request: IndexerSearchRequest): Promise<IndexerSearchPage>;
  fetchMetainfo(url: string, signal?: AbortSignal): Promise<Uint8Array>;
}

export type TorrentStatus =
  | "stopped"
  | "queued-to-verify"
  | "verifying"
  | "queued-to-download"
  | "downloading"
  | "queued-to-seed"
  | "seeding"
  | "unknown";

export interface TorrentFile {
  index: number;
  name: string;
  length: number;
  bytesCompleted: number;
  wanted: boolean;
  priority: "low" | "normal" | "high";
}

export interface TorrentSnapshot {
  hash: string;
  name: string;
  status: TorrentStatus;
  progress: number;
  metadataProgress: number;
  totalSize: number;
  sizeWhenDone: number;
  leftUntilDone: number;
  downloadRate: number;
  uploadRate: number;
  etaSeconds: number | null;
  downloadDirectory: string;
  labels: readonly string[];
  finished: boolean;
  stalled: boolean;
  error: string | null;
  files: readonly TorrentFile[];
}

export type TorrentInput =
  | { magnetUri: string; metainfo?: never }
  | { magnetUri?: never; metainfo: Uint8Array | string };

export interface AddTorrentOptions {
  downloadDirectory?: string;
  labels?: readonly string[];
  paused?: boolean;
  peerLimit?: number;
  wantedFiles?: readonly number[];
  unwantedFiles?: readonly number[];
}

export interface AddedTorrent {
  hash: string;
  name: string;
  duplicate: boolean;
}

export interface TorrentEngine {
  add(
    source: TorrentInput,
    options?: AddTorrentOptions,
    signal?: AbortSignal,
  ): Promise<AddedTorrent>;
  get(hash: string, signal?: AbortSignal): Promise<TorrentSnapshot | null>;
  list(signal?: AbortSignal): Promise<readonly TorrentSnapshot[]>;
  selectFiles(
    hash: string,
    selection: {
      wanted?: readonly number[];
      unwanted?: readonly number[];
      priorityHigh?: readonly number[];
      priorityNormal?: readonly number[];
      priorityLow?: readonly number[];
    },
    signal?: AbortSignal,
  ): Promise<void>;
  start(hash: string, signal?: AbortSignal): Promise<void>;
  pause(hash: string, signal?: AbortSignal): Promise<void>;
  remove(
    hash: string,
    deleteData?: boolean,
    signal?: AbortSignal,
  ): Promise<void>;
}

export interface LibraryOrganizationRequest {
  downloadId: string;
  downloadDirectory: string;
  target: ReleaseTarget;
  torrentName: string;
  files: readonly TorrentFile[];
}

export interface OrganizedFile {
  source: string;
  destination: string;
  created: boolean;
}

export interface LibraryOrganizer {
  organize(
    request: LibraryOrganizationRequest,
    signal?: AbortSignal,
  ): Promise<readonly OrganizedFile[]>;
}

export type CandidateSource =
  | { kind: "magnet"; magnetUri: string }
  | { kind: "jackett"; downloadUrl: string }
  | { kind: "metainfo"; metainfoBase64: string };

export interface ProtectedCandidatePayload {
  source: CandidateSource;
  target: ReleaseTarget;
  infoHash: string | null;
}

export interface CandidateCipher {
  seal(payload: ProtectedCandidatePayload): Promise<string>;
  open(ciphertext: string): Promise<ProtectedCandidatePayload>;
}

export interface StoredCandidate {
  id: string;
  title: string;
  indexer: string | null;
  sizeBytes: number;
  seeders: number;
  peers: number;
  score: number;
  reasons: readonly string[];
  facts: ReleaseFacts;
  sourceCiphertext: string;
  createdAt: number;
  expiresAt: number;
}

export interface NewStoredCandidate extends Omit<StoredCandidate, "id"> {
  target: ReleaseTarget;
  tmdbId: number | null;
  mediaId: string | null;
  publishedAt: string | null;
}

export interface CandidateRepository {
  saveMany(
    candidates: readonly NewStoredCandidate[],
  ): Promise<readonly StoredCandidate[]>;
  findById(id: string): Promise<StoredCandidate | null>;
  deleteExpired(now: number): Promise<number>;
}

export type DownloadState =
  | "queued"
  | "submitting"
  | "downloading"
  | "paused"
  | "completed"
  | "organizing"
  | "organized"
  | "missing"
  | "failed"
  | "removed";

export interface DownloadRecord {
  id: string;
  candidateId: string | null;
  target: ReleaseTarget;
  title: string;
  state: DownloadState;
  sourceCiphertext: string;
  expectedInfoHash: string | null;
  engineInfoHash: string | null;
  engineName: string | null;
  engineLabel: string;
  downloadDirectory: string;
  progress: number;
  error: string | null;
  pausedRequested: boolean;
  peerLimit: number | null;
  createdAt: number;
  updatedAt: number;
  lastEngineSeenAt: number | null;
}

export interface DownloadPatch {
  state?: DownloadState;
  engineInfoHash?: string | null;
  engineName?: string | null;
  progress?: number;
  error?: string | null;
  updatedAt: number;
  lastEngineSeenAt?: number | null;
}

export interface DownloadRepository {
  insert(download: DownloadRecord): Promise<void>;
  findById(id: string): Promise<DownloadRecord | null>;
  listForReconciliation(): Promise<readonly DownloadRecord[]>;
  transition(
    id: string,
    expectedStates: readonly DownloadState[],
    patch: DownloadPatch,
  ): Promise<DownloadRecord | null>;
}

export interface CandidateSearchInput {
  target: ReleaseTarget;
  profile?: ReleaseProfile;
  mediaId?: string;
  query?: string;
  categories?: readonly number[];
  tmdbId?: number;
  imdbId?: string;
  tvdbId?: number;
  limit?: number;
  signal?: AbortSignal;
}

export interface ProtectedCandidate {
  id: string;
  title: string;
  indexer: string | null;
  sizeBytes: number;
  seeders: number;
  peers: number;
  score: number;
  reasons: readonly string[];
  facts: ReleaseFacts;
  expiresAt: number;
}

export interface ExcludedRelease {
  title: string;
  indexer: string | null;
  exclusions: readonly string[];
}

export interface CandidateSearchResult {
  candidates: readonly ProtectedCandidate[];
  excluded: readonly ExcludedRelease[];
  rawTotal: number;
  deduplicatedTotal: number;
  expiresAt: number;
  query: string;
}

export interface ReconciliationResult {
  matched: number;
  missing: readonly string[];
  requeued: readonly string[];
  orphanedTorrents: readonly { hash: string; label: string }[];
}

export type DownloadView = Omit<DownloadRecord, "sourceCiphertext">;

export interface AcquisitionDependencies {
  indexer: IndexerGateway;
  torrentEngine: TorrentEngine;
  candidateRepository: CandidateRepository;
  downloadRepository: DownloadRepository;
  candidateCipher: CandidateCipher;
  jobQueue: JobQueue;
  libraryOrganizer?: LibraryOrganizer;
}
