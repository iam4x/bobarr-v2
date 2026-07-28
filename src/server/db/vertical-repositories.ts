import type {
  ActivityEvent,
  ActivityQuery,
  CreateActivityEventInput,
  CreateDownloadInput,
  CreateLibraryFileInput,
  Download,
  DownloadPatch,
  DownloadsQuery,
  LibraryFile,
  MediaKind,
  MetadataCacheEntry,
  MetadataCacheKey,
  ReleaseCandidate,
  ReleaseCandidateInput,
  ScanReview,
  ScanReviewCandidate,
  ScanReviewFile,
  ScanReviewKind,
  ScanReviewListQuery,
} from "../../contracts";
import type { Clock } from "../core";
import type { BackendDatabase } from "./database";

import {
  and,
  desc,
  eq,
  gt,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  activityEvents,
  downloads,
  libraryFiles,
  libraryScanReviews,
  metadataCache,
  releaseCandidates,
} from "./schema";
import {
  ScanReviewCandidateSchema,
  ScanReviewFileSchema,
} from "../../contracts";
import { parseJsonObject, systemClock, toIsoDate } from "../core";

type ReleaseCandidateRow = typeof releaseCandidates.$inferSelect;
type DownloadRow = typeof downloads.$inferSelect;
type LibraryFileRow = typeof libraryFiles.$inferSelect;
type ActivityEventRow = typeof activityEvents.$inferSelect;
type MetadataCacheRow = typeof metadataCache.$inferSelect;
type LibraryScanReviewRow = typeof libraryScanReviews.$inferSelect;

export interface UpsertScanReviewInput {
  kind: ScanReviewKind;
  title: string;
  year: number | null;
  rootPath: string;
  files: ScanReviewFile[];
  candidates: ScanReviewCandidate[];
}

export interface CreateReleaseCandidateInput extends ReleaseCandidateInput {
  /** Encrypted or otherwise sealed source data. It is never returned by list/get methods. */
  protectedSourcePayload: string;
  ttlSeconds?: number;
}

export interface ResolvedReleaseCandidate {
  candidate: ReleaseCandidate;
  protectedSourcePayload: string;
}

export interface ReleaseCandidateQuery {
  mediaItemId?: string;
  tmdbId?: number;
  mediaKind?: MediaKind;
  eligibleOnly?: boolean;
}

export class ReleaseCandidateRepository {
  constructor(
    private readonly database: BackendDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  create(input: CreateReleaseCandidateInput): ReleaseCandidate {
    const now = this.clock.now().getTime();
    const expiresAt = now + (input.ttlSeconds ?? 15 * 60) * 1000;
    const row = this.database.client
      .insert(releaseCandidates)
      .values({
        id: createReleaseId(),
        mediaItemId: input.mediaId,
        tmdbId: input.tmdbId,
        mediaKind: input.mediaKind,
        title: input.title,
        indexer: input.indexer,
        sizeBytes: input.sizeBytes,
        seeders: input.seeders,
        leechers: input.leechers,
        publishedAt:
          input.publishedAt === null ? null : Date.parse(input.publishedAt),
        quality: input.quality,
        score: input.score,
        eligible: input.eligible,
        reasonsJson: JSON.stringify(input.reasons),
        protectedSourcePayload: input.protectedSourcePayload,
        expiresAt,
        createdAt: now,
      })
      .returning()
      .get();
    return mapReleaseCandidate(row);
  }

  get(id: string): ReleaseCandidate | undefined {
    const row = this.getFreshRow(id);
    return row === undefined ? undefined : mapReleaseCandidate(row);
  }

  resolve(id: string): ResolvedReleaseCandidate | undefined {
    const row = this.getFreshRow(id);
    if (row === undefined) return undefined;
    return {
      candidate: mapReleaseCandidate(row),
      protectedSourcePayload: row.protectedSourcePayload,
    };
  }

  list(query: ReleaseCandidateQuery = {}): ReleaseCandidate[] {
    const filters: SQL[] = [
      gt(releaseCandidates.expiresAt, this.clock.now().getTime()),
    ];
    if (query.mediaItemId !== undefined) {
      filters.push(eq(releaseCandidates.mediaItemId, query.mediaItemId));
    }
    if (query.tmdbId !== undefined)
      filters.push(eq(releaseCandidates.tmdbId, query.tmdbId));
    if (query.mediaKind !== undefined) {
      filters.push(eq(releaseCandidates.mediaKind, query.mediaKind));
    }
    if (query.eligibleOnly === true)
      filters.push(eq(releaseCandidates.eligible, true));
    return this.database.client
      .select()
      .from(releaseCandidates)
      .where(and(...filters))
      .orderBy(desc(releaseCandidates.score), desc(releaseCandidates.seeders))
      .all()
      .map(mapReleaseCandidate);
  }

  purgeExpired(): number {
    const deleted = this.database.client
      .delete(releaseCandidates)
      .where(lte(releaseCandidates.expiresAt, this.clock.now().getTime()))
      .returning({ id: releaseCandidates.id })
      .all();
    return deleted.length;
  }

  private getFreshRow(id: string): ReleaseCandidateRow | undefined {
    return this.database.client
      .select()
      .from(releaseCandidates)
      .where(
        and(
          eq(releaseCandidates.id, id),
          gt(releaseCandidates.expiresAt, this.clock.now().getTime()),
        ),
      )
      .get();
  }
}

export class DownloadRepository {
  constructor(
    private readonly database: BackendDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  create(input: CreateDownloadInput): Download {
    const now = this.clock.now().getTime();
    const row = this.database.client
      .insert(downloads)
      .values({
        id: crypto.randomUUID(),
        mediaItemId: input.mediaId,
        releaseCandidateId: input.releaseCandidateId,
        client: input.client,
        externalId: input.externalId,
        title: input.title,
        state: input.state,
        totalBytes: input.totalBytes,
        downloadPath: input.downloadPath,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return mapDownload(row);
  }

  get(id: string): Download | undefined {
    const row = this.database.client
      .select()
      .from(downloads)
      .where(
        and(
          eq(downloads.id, id),
          or(
            isNull(downloads.acquisitionState),
            ne(downloads.acquisitionState, "removed"),
          ),
        ),
      )
      .get();
    return row === undefined ? undefined : mapDownload(row);
  }

  getByExternalId(client: string, externalId: string): Download | undefined {
    const row = this.database.client
      .select()
      .from(downloads)
      .where(
        and(
          eq(downloads.client, client),
          eq(downloads.externalId, externalId),
          or(
            isNull(downloads.acquisitionState),
            ne(downloads.acquisitionState, "removed"),
          ),
        ),
      )
      .get();
    return row === undefined ? undefined : mapDownload(row);
  }

  update(id: string, patch: DownloadPatch): Download | undefined {
    const now = this.clock.now().getTime();
    const values: Partial<typeof downloads.$inferInsert> = {
      ...patch,
      updatedAt: now,
    };
    if (patch.state === "completed") values.completedAt = now;
    const row = this.database.client
      .update(downloads)
      .set(values)
      .where(eq(downloads.id, id))
      .returning()
      .get();
    return row === undefined ? undefined : mapDownload(row);
  }

  list(query: DownloadsQuery): { downloads: Download[]; total: number } {
    const filters: SQL[] = [
      or(
        isNull(downloads.acquisitionState),
        ne(downloads.acquisitionState, "removed"),
      )!,
    ];
    if (query.state !== undefined) {
      filters.push(eq(downloads.state, query.state));
    } else if (query.completion === "active") {
      filters.push(ne(downloads.state, "completed"));
    } else if (query.completion === "completed") {
      filters.push(eq(downloads.state, "completed"));
    }
    if (query.mediaId !== undefined)
      filters.push(eq(downloads.mediaItemId, query.mediaId));
    const where = filters.length === 0 ? undefined : and(...filters);
    const rows = this.database.client
      .select()
      .from(downloads)
      .where(where)
      .orderBy(desc(downloads.updatedAt), desc(downloads.id))
      .limit(query.limit)
      .offset(query.offset)
      .all();
    const total = this.database.client
      .select({ count: sql<number>`count(*)` })
      .from(downloads)
      .where(where)
      .get()?.count;
    return { downloads: rows.map(mapDownload), total: Number(total ?? 0) };
  }
}

export class LibraryFileRepository {
  constructor(
    private readonly database: BackendDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  upsert(input: CreateLibraryFileInput): LibraryFile {
    const now = this.clock.now().getTime();
    const row = this.database.client
      .insert(libraryFiles)
      .values({
        id: crypto.randomUUID(),
        mediaItemId: input.mediaId,
        downloadId: input.downloadId,
        path: input.path,
        sizeBytes: input.sizeBytes,
        quality: input.quality,
        videoCodec: input.videoCodec,
        audioCodec: input.audioCodec,
        strategy: input.strategy,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: libraryFiles.path,
        set: {
          mediaItemId: input.mediaId,
          downloadId: input.downloadId,
          sizeBytes: input.sizeBytes,
          quality: input.quality,
          videoCodec: input.videoCodec,
          audioCodec: input.audioCodec,
          strategy: input.strategy,
          updatedAt: now,
        },
      })
      .returning()
      .get();
    return mapLibraryFile(row);
  }

  listForMedia(mediaId: string): LibraryFile[] {
    return this.database.client
      .select()
      .from(libraryFiles)
      .where(eq(libraryFiles.mediaItemId, mediaId))
      .orderBy(libraryFiles.path)
      .all()
      .map(mapLibraryFile);
  }

  get(id: string): LibraryFile | undefined {
    const row = this.database.client
      .select()
      .from(libraryFiles)
      .where(eq(libraryFiles.id, id))
      .get();
    return row ? mapLibraryFile(row) : undefined;
  }

  delete(id: string): boolean {
    return (
      this.database.client
        .delete(libraryFiles)
        .where(eq(libraryFiles.id, id))
        .returning({ id: libraryFiles.id })
        .get() !== undefined
    );
  }
}

export class ActivityRepository {
  constructor(
    private readonly database: BackendDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  append(input: CreateActivityEventInput): ActivityEvent {
    const row = this.database.client
      .insert(activityEvents)
      .values({
        id: crypto.randomUUID(),
        type: input.type,
        level: input.level,
        message: input.message,
        entityType: input.entityType,
        entityId: input.entityId,
        dataJson: JSON.stringify(input.data),
        createdAt: this.clock.now().getTime(),
      })
      .returning()
      .get();
    return mapActivityEvent(row);
  }

  list(query: ActivityQuery): { events: ActivityEvent[]; total: number } {
    const filters: SQL[] = [];
    if (query.level !== undefined)
      filters.push(eq(activityEvents.level, query.level));
    if (query.entityType !== undefined) {
      filters.push(eq(activityEvents.entityType, query.entityType));
    }
    if (query.entityId !== undefined)
      filters.push(eq(activityEvents.entityId, query.entityId));
    const where = filters.length === 0 ? undefined : and(...filters);
    const rows = this.database.client
      .select()
      .from(activityEvents)
      .where(where)
      .orderBy(desc(activityEvents.createdAt))
      .limit(query.limit)
      .offset(query.offset)
      .all();
    const total = this.database.client
      .select({ count: sql<number>`count(*)` })
      .from(activityEvents)
      .where(where)
      .get()?.count;
    return { events: rows.map(mapActivityEvent), total: Number(total ?? 0) };
  }
}

export class LibraryScanReviewRepository {
  constructor(
    private readonly database: BackendDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  upsert(input: UpsertScanReviewInput): ScanReview {
    if (input.files.length === 0) {
      throw new TypeError("A library scan review requires at least one file");
    }
    const now = this.clock.now().getTime();
    const fingerprint = createScanReviewFingerprint(input);
    const values: typeof libraryScanReviews.$inferInsert = {
      id: crypto.randomUUID(),
      fingerprint,
      kind: input.kind,
      title: input.title,
      year: input.year,
      rootPath: input.rootPath,
      filesJson: JSON.stringify(input.files),
      candidatesJson: JSON.stringify(input.candidates),
      createdAt: now,
      updatedAt: now,
    };
    const row = this.database.client
      .insert(libraryScanReviews)
      .values(values)
      .onConflictDoUpdate({
        target: libraryScanReviews.fingerprint,
        set: {
          title: input.title,
          year: input.year,
          rootPath: input.rootPath,
          filesJson: values.filesJson,
          candidatesJson: values.candidatesJson,
          updatedAt: now,
        },
      })
      .returning()
      .get();
    return mapScanReview(row);
  }

  get(id: string): ScanReview | undefined {
    const row = this.database.client
      .select()
      .from(libraryScanReviews)
      .where(eq(libraryScanReviews.id, id))
      .get();
    return row === undefined ? undefined : mapScanReview(row);
  }

  list(query: ScanReviewListQuery): {
    reviews: ScanReview[];
    total: number;
  } {
    const filters: SQL[] = [];
    if (query.status !== undefined) {
      filters.push(eq(libraryScanReviews.status, query.status));
    }
    if (query.kind !== undefined) {
      filters.push(eq(libraryScanReviews.kind, query.kind));
    }
    const where = filters.length === 0 ? undefined : and(...filters);
    const rows = this.database.client
      .select()
      .from(libraryScanReviews)
      .where(where)
      .orderBy(desc(libraryScanReviews.updatedAt))
      .limit(query.limit)
      .offset(query.offset)
      .all();
    const total = this.database.client
      .select({ count: sql<number>`count(*)` })
      .from(libraryScanReviews)
      .where(where)
      .get()?.count;
    return {
      reviews: rows.map(mapScanReview),
      total: Number(total ?? 0),
    };
  }

  resolve(
    id: string,
    tmdbId: number,
    mediaItemId: string,
  ): ScanReview | undefined {
    const now = this.clock.now().getTime();
    const row = this.database.client
      .update(libraryScanReviews)
      .set({
        status: "resolved",
        resolvedTmdbId: tmdbId,
        mediaItemId,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(libraryScanReviews.id, id),
          eq(libraryScanReviews.status, "pending"),
        ),
      )
      .returning()
      .get();
    return row === undefined ? undefined : mapScanReview(row);
  }

  dismiss(id: string): ScanReview | undefined {
    const now = this.clock.now().getTime();
    const row = this.database.client
      .update(libraryScanReviews)
      .set({ status: "dismissed", resolvedAt: now, updatedAt: now })
      .where(
        and(
          eq(libraryScanReviews.id, id),
          eq(libraryScanReviews.status, "pending"),
        ),
      )
      .returning()
      .get();
    return row === undefined ? undefined : mapScanReview(row);
  }
}

export class MetadataCacheRepository {
  constructor(
    private readonly database: BackendDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  get(
    key: MetadataCacheKey,
    options: { allowStale?: boolean } = {},
  ): MetadataCacheEntry | undefined {
    const filters: SQL[] = [
      eq(metadataCache.provider, key.provider),
      eq(metadataCache.mediaKind, key.kind),
      eq(metadataCache.externalId, key.externalId),
      eq(metadataCache.locale, key.locale),
    ];
    if (options.allowStale !== true) {
      filters.push(gt(metadataCache.expiresAt, this.clock.now().getTime()));
    }
    const row = this.database.client
      .select()
      .from(metadataCache)
      .where(and(...filters))
      .get();
    return row === undefined ? undefined : mapMetadataCache(row);
  }

  upsert(entry: MetadataCacheEntry): MetadataCacheEntry {
    const values: typeof metadataCache.$inferInsert = {
      provider: entry.provider,
      mediaKind: entry.kind,
      externalId: entry.externalId,
      locale: entry.locale,
      valueJson: JSON.stringify(entry.value),
      etag: entry.etag,
      fetchedAt: Date.parse(entry.fetchedAt),
      expiresAt: Date.parse(entry.expiresAt),
    };
    const row = this.database.client
      .insert(metadataCache)
      .values(values)
      .onConflictDoUpdate({
        target: [
          metadataCache.provider,
          metadataCache.mediaKind,
          metadataCache.externalId,
          metadataCache.locale,
        ],
        set: {
          valueJson: values.valueJson,
          etag: values.etag,
          fetchedAt: values.fetchedAt,
          expiresAt: values.expiresAt,
        },
      })
      .returning()
      .get();
    return mapMetadataCache(row);
  }

  purgeExpired(): number {
    return this.database.client
      .delete(metadataCache)
      .where(lte(metadataCache.expiresAt, this.clock.now().getTime()))
      .returning({ externalId: metadataCache.externalId })
      .all().length;
  }
}

function createReleaseId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `rel_${bytes.toBase64({ alphabet: "base64url", omitPadding: true })}`;
}

function mapReleaseCandidate(row: ReleaseCandidateRow): ReleaseCandidate {
  return {
    id: row.id,
    mediaId: row.mediaItemId,
    tmdbId: row.tmdbId,
    mediaKind: row.mediaKind,
    title: row.title,
    indexer: row.indexer,
    sizeBytes: row.sizeBytes,
    seeders: row.seeders,
    leechers: row.leechers,
    publishedAt: row.publishedAt === null ? null : toIsoDate(row.publishedAt),
    quality: row.quality,
    score: row.score,
    eligible: row.eligible,
    reasons: parseStringArray(row.reasonsJson, "release reasons"),
    expiresAt: toIsoDate(row.expiresAt),
    createdAt: toIsoDate(row.createdAt),
  };
}

function mapDownload(row: DownloadRow): Download {
  return {
    id: row.id,
    mediaId: row.mediaItemId,
    releaseCandidateId: row.releaseCandidateId,
    client: row.client,
    externalId: row.externalId,
    title: row.title,
    state: row.state,
    progress: row.progress,
    downloadedBytes: row.downloadedBytes,
    totalBytes: row.totalBytes,
    downloadRate: row.downloadRate,
    uploadRate: row.uploadRate,
    etaSeconds: row.etaSeconds,
    downloadPath: row.downloadPath,
    error: row.error,
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
    completedAt: row.completedAt === null ? null : toIsoDate(row.completedAt),
  };
}

function mapLibraryFile(row: LibraryFileRow): LibraryFile {
  return {
    id: row.id,
    mediaId: row.mediaItemId,
    downloadId: row.downloadId,
    path: row.path,
    sizeBytes: row.sizeBytes,
    quality: row.quality,
    videoCodec: row.videoCodec,
    audioCodec: row.audioCodec,
    strategy: row.strategy,
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
  };
}

function mapActivityEvent(row: ActivityEventRow): ActivityEvent {
  return {
    id: row.id,
    type: row.type,
    level: row.level,
    message: row.message,
    entityType: row.entityType,
    entityId: row.entityId,
    data: parseJsonObject(row.dataJson, "activity data"),
    createdAt: toIsoDate(row.createdAt),
  };
}

function mapMetadataCache(row: MetadataCacheRow): MetadataCacheEntry {
  return {
    provider: row.provider,
    kind: row.mediaKind,
    externalId: row.externalId,
    locale: row.locale,
    value: parseJsonObject(row.valueJson, "metadata cache value"),
    etag: row.etag,
    fetchedAt: toIsoDate(row.fetchedAt),
    expiresAt: toIsoDate(row.expiresAt),
  };
}

function createScanReviewFingerprint(input: UpsertScanReviewInput): string {
  return new Bun.CryptoHasher("sha256")
    .update(
      JSON.stringify([
        input.kind,
        input.rootPath,
        input.title.trim().toLocaleLowerCase(),
        input.year,
      ]),
    )
    .digest("hex");
}

function mapScanReview(row: LibraryScanReviewRow): ScanReview {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    year: row.year,
    rootPath: row.rootPath,
    files: parseScanReviewFiles(row.filesJson),
    candidates: parseScanReviewCandidates(row.candidatesJson),
    status: row.status,
    resolvedTmdbId: row.resolvedTmdbId,
    mediaItemId: row.mediaItemId,
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
    resolvedAt: row.resolvedAt === null ? null : toIsoDate(row.resolvedAt),
  };
}

function parseScanReviewFiles(value: string): ScanReviewFile[] {
  return ScanReviewFileSchema.array().parse(JSON.parse(value));
}

function parseScanReviewCandidates(value: string): ScanReviewCandidate[] {
  return ScanReviewCandidateSchema.array().parse(JSON.parse(value));
}

function parseStringArray(value: string, label: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string"))
    return parsed;
  throw new TypeError(`Stored ${label} is invalid`);
}
