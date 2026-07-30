import type { BackendDatabase } from "./database";

import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  admins,
  appSettings,
  calendarEvents,
  encryptedSecrets,
  jobRecords,
  libraryItems,
  sessions,
} from "./schema";
import {
  ActivityRepository,
  DownloadRepository,
  LibraryFileRepository,
  LibraryScanReviewRepository,
  MetadataCacheRepository,
  ReleaseCandidateRepository,
} from "./vertical-repositories";
import {
  AppSettingsSchema,
  type Admin,
  type AppSettings,
  type CalendarEvent,
  type CreateCalendarEventRequest,
  type CreateJobRequest,
  type CreateLibraryItemRequest,
  type Job,
  type JobStatus,
  type LibraryItem,
  type LibraryQuery,
  type MediaKind,
  type AcquisitionState,
  type DownloadState,
  type MonitorPolicy,
  type SecretMetadata,
  type SettingsResponse,
} from "../../contracts";
import {
  type Clock,
  AppError,
  parseJsonObject,
  systemClock,
  toIsoDate,
} from "../core";

type AdminRow = typeof admins.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;
type LibraryItemRow = typeof libraryItems.$inferSelect;
type CalendarEventRow = typeof calendarEvents.$inferSelect;
type JobRow = typeof jobRecords.$inferSelect;

export interface AuthenticatedSessionRecord {
  session: SessionRow;
  admin: AdminRow;
}

export interface NewSessionRecord {
  id: string;
  adminId: number;
  tokenHash: string;
  csrfHash: string;
  createdAt: number;
  expiresAt: number;
  userAgent: string | null;
  ipAddress: string | null;
}

export class AuthRepository {
  constructor(private readonly database: BackendDatabase) {}

  isSetupComplete(): boolean {
    return (
      this.database.client
        .select({ id: admins.id })
        .from(admins)
        .limit(1)
        .get() !== undefined
    );
  }

  getAdminByUsername(username: string): AdminRow | undefined {
    return this.database.client
      .select()
      .from(admins)
      .where(sql`lower(${admins.username}) = lower(${username})`)
      .get();
  }

  getAdmin(): AdminRow | undefined {
    return this.database.client
      .select()
      .from(admins)
      .where(eq(admins.id, 1))
      .get();
  }

  createAdmin(username: string, passwordHash: string, now: number): AdminRow {
    try {
      return this.database.client
        .insert(admins)
        .values({
          id: 1,
          username,
          passwordHash,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
    } catch (error) {
      throw new AppError({
        code: "already_configured",
        message: "Bobarr has already been configured",
        status: 409,
        cause: error,
      });
    }
  }

  recordFailedLogin(
    adminId: number,
    failureLimit: number,
    lockUntil: number,
    now: number,
  ): { failedLoginCount: number; lockedUntil: number | null } {
    const row = this.database.client
      .update(admins)
      .set({
        failedLoginCount: sql`${admins.failedLoginCount} + 1`,
        lockedUntil: sql`CASE
          WHEN ${admins.failedLoginCount} + 1 >= ${failureLimit}
          THEN ${lockUntil}
          ELSE ${admins.lockedUntil}
        END`,
        updatedAt: now,
      })
      .where(eq(admins.id, adminId))
      .returning({
        failedLoginCount: admins.failedLoginCount,
        lockedUntil: admins.lockedUntil,
      })
      .get();
    if (!row) throw new Error("Administrator disappeared during sign-in");
    return row;
  }

  recordSuccessfulLogin(adminId: number, now: number): void {
    this.database.client
      .update(admins)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: now,
        updatedAt: now,
      })
      .where(eq(admins.id, adminId))
      .run();
  }

  resetLoginLock(adminId: number, now: number): void {
    this.database.client
      .update(admins)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(eq(admins.id, adminId))
      .run();
  }

  updateAdminCredentials(
    adminId: number,
    input: { username: string; passwordHash?: string },
    now: number,
  ): AdminRow {
    const admin = this.database.client
      .update(admins)
      .set({
        username: input.username,
        ...(input.passwordHash === undefined
          ? {}
          : { passwordHash: input.passwordHash }),
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(eq(admins.id, adminId))
      .returning()
      .get();
    if (!admin) throw new Error("Administrator disappeared during update");
    return admin;
  }

  createSession(record: NewSessionRecord): SessionRow {
    return this.database.client
      .insert(sessions)
      .values({ ...record, lastSeenAt: record.createdAt })
      .returning()
      .get();
  }

  getSessionByTokenHash(
    tokenHash: string,
  ): AuthenticatedSessionRecord | undefined {
    const row = this.database.client
      .select({ session: sessions, admin: admins })
      .from(sessions)
      .innerJoin(admins, eq(sessions.adminId, admins.id))
      .where(eq(sessions.tokenHash, tokenHash))
      .get();
    return row;
  }

  touchSession(id: string, now: number): void {
    this.database.client
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(eq(sessions.id, id))
      .run();
  }

  revokeSession(id: string, now: number): void {
    this.database.client
      .update(sessions)
      .set({ revokedAt: now })
      .where(eq(sessions.id, id))
      .run();
  }

  deleteExpiredSessions(now: number): void {
    this.database.client
      .delete(sessions)
      .where(lte(sessions.expiresAt, now))
      .run();
  }
}

export class SettingsRepository {
  constructor(
    private readonly database: BackendDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  ensureDefaults(): SettingsResponse {
    const existing = this.get();
    if (existing !== undefined) return existing;

    const now = this.clock.now().getTime();
    const settings = AppSettingsSchema.parse({});
    this.database.client
      .insert(appSettings)
      .values({
        id: 1,
        value: JSON.stringify(settings),
        version: 1,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
    return this.getRequired();
  }

  get(): SettingsResponse | undefined {
    const row = this.database.client
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .get();
    if (row === undefined) return undefined;
    return {
      settings: this.parseSettings(row.value),
      version: row.version,
      updatedAt: toIsoDate(row.updatedAt),
    };
  }

  getRequired(): SettingsResponse {
    const settings = this.get();
    if (settings === undefined) {
      throw new AppError({
        code: "internal_error",
        message: "Settings are unavailable",
        status: 500,
      });
    }
    return settings;
  }

  update(patch: Partial<AppSettings>): SettingsResponse {
    const current = this.ensureDefaults();
    const next = AppSettingsSchema.parse({
      ...current.settings,
      ...patch,
      locale: { ...current.settings.locale, ...patch.locale },
      integrations: {
        ...current.settings.integrations,
        ...patch.integrations,
      },
      acquisition: {
        ...current.settings.acquisition,
        ...patch.acquisition,
      },
      storage: { ...current.settings.storage, ...patch.storage },
      schedules: { ...current.settings.schedules, ...patch.schedules },
      security: { ...current.settings.security, ...patch.security },
    });
    const now = this.clock.now().getTime();
    this.database.client
      .update(appSettings)
      .set({
        value: JSON.stringify(next),
        version: current.version + 1,
        updatedAt: now,
      })
      .where(eq(appSettings.id, 1))
      .run();
    return this.getRequired();
  }

  private parseSettings(value: string): AppSettings {
    try {
      return AppSettingsSchema.parse(JSON.parse(value));
    } catch (error) {
      throw new AppError({
        code: "internal_error",
        message: "Stored settings are invalid",
        status: 500,
        cause: error,
      });
    }
  }
}

export interface EncryptedSecretRecord {
  name: string;
  ciphertext: string;
  nonce: string;
  keyVersion: number;
  updatedAt: number;
}

export class SecretRepository {
  constructor(private readonly database: BackendDatabase) {}

  get(name: string): EncryptedSecretRecord | undefined {
    return this.database.client
      .select()
      .from(encryptedSecrets)
      .where(eq(encryptedSecrets.name, name))
      .get();
  }

  list(): SecretMetadata[] {
    return this.database.client
      .select({
        name: encryptedSecrets.name,
        updatedAt: encryptedSecrets.updatedAt,
      })
      .from(encryptedSecrets)
      .orderBy(encryptedSecrets.name)
      .all()
      .map((row) => ({
        name: row.name,
        configured: true,
        updatedAt: toIsoDate(row.updatedAt),
      }));
  }

  upsert(record: EncryptedSecretRecord): SecretMetadata {
    this.database.client
      .insert(encryptedSecrets)
      .values(record)
      .onConflictDoUpdate({
        target: encryptedSecrets.name,
        set: {
          ciphertext: record.ciphertext,
          nonce: record.nonce,
          keyVersion: record.keyVersion,
          updatedAt: record.updatedAt,
        },
      })
      .run();
    return {
      name: record.name,
      configured: true,
      updatedAt: toIsoDate(record.updatedAt),
    };
  }

  delete(name: string): boolean {
    return (
      this.database.client
        .delete(encryptedSecrets)
        .where(eq(encryptedSecrets.name, name))
        .returning({ name: encryptedSecrets.name })
        .get() !== undefined
    );
  }
}

export interface LibraryCardDownloadProjection {
  id: string;
  externalId: string | null;
  state: DownloadState;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  downloadRate: number;
  uploadRate: number;
  etaSeconds: number | null;
  downloadPath: string | null;
  error: string | null;
  active: boolean;
}

export interface LibraryCardProjection {
  rootId: string;
  libraryPath: string | null;
  fileCount: number;
  totalBytes: number;
  quality: string | null;
  episodeAvailable: number;
  episodeTotal: number;
  nextAirAt: number | null;
  download: LibraryCardDownloadProjection | null;
}

export interface LibrarySummary {
  total: number;
  downloaded: number;
  active: number;
  missing: number;
  failed: number;
}

interface LibraryCardProjectionRow {
  rootId: string;
  libraryPath: string | null;
  fileCount: number | null;
  fileBytes: number | null;
  quality: string | null;
  episodeAvailable: number | null;
  episodeTotal: number | null;
  nextAirAt: number | null;
  downloadId: string | null;
  downloadExternalId: string | null;
  downloadState: DownloadState | null;
  downloadProgress: number | null;
  downloadedBytes: number | null;
  downloadTotalBytes: number | null;
  downloadRate: number | null;
  uploadRate: number | null;
  etaSeconds: number | null;
  downloadPath: string | null;
  downloadError: string | null;
  downloadActive: number | null;
}

export class LibraryRepository {
  constructor(
    private readonly database: BackendDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  create(input: CreateLibraryItemRequest): LibraryItem {
    const now = this.clock.now().getTime();
    try {
      const row = this.database.client
        .insert(libraryItems)
        .values({
          id: crypto.randomUUID(),
          tmdbId: input.tmdbId,
          kind: input.kind,
          parentId: input.parentId,
          seasonNumber: input.seasonNumber,
          episodeNumber: input.episodeNumber,
          title: input.title,
          year: input.year,
          posterUrl: input.posterUrl,
          monitorPolicy: input.monitorPolicy,
          acquisitionState: input.acquisitionState ?? input.status,
          releaseDate:
            input.releaseDate === null ? null : Date.parse(input.releaseDate),
          metadataJson: JSON.stringify(input.metadata),
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      return mapLibraryItem(row);
    } catch (error) {
      throw new AppError({
        code: "conflict",
        message:
          "The media item conflicts with an existing record or missing parent",
        status: 409,
        cause: error,
      });
    }
  }

  get(id: string): LibraryItem | undefined {
    const row = this.database.client
      .select()
      .from(libraryItems)
      .where(eq(libraryItems.id, id))
      .get();
    return row === undefined ? undefined : mapLibraryItem(row);
  }

  getByTmdb(kind: MediaKind, tmdbId: number): LibraryItem | undefined {
    const row = this.database.client
      .select()
      .from(libraryItems)
      .where(and(eq(libraryItems.kind, kind), eq(libraryItems.tmdbId, tmdbId)))
      .get();
    return row === undefined ? undefined : mapLibraryItem(row);
  }

  recommendationSources(query: {
    kind: "movie" | "series";
    limit: number;
    cursor: number;
  }): { items: LibraryItem[]; total: number } {
    const where = and(
      eq(libraryItems.kind, query.kind),
      isNull(libraryItems.parentId),
      isNotNull(libraryItems.tmdbId),
    );
    const total = Number(
      this.database.client
        .select({ count: sql<number>`count(*)` })
        .from(libraryItems)
        .where(where)
        .get()?.count ?? 0,
    );
    const limit = Math.min(Math.max(0, Math.trunc(query.limit)), total);
    if (limit === 0) return { items: [], total };

    const cursor = ((Math.trunc(query.cursor) % total) + total) % total;
    const load = (offset: number, count: number) =>
      this.database.client
        .select()
        .from(libraryItems)
        .where(where)
        .orderBy(desc(libraryItems.createdAt), desc(libraryItems.id))
        .limit(count)
        .offset(offset)
        .all();
    const rows = load(cursor, limit);
    if (rows.length < limit) {
      rows.push(...load(0, limit - rows.length));
    }
    return { items: rows.map(mapLibraryItem), total };
  }

  children(parentId: string): LibraryItem[] {
    return this.database.client
      .select()
      .from(libraryItems)
      .where(eq(libraryItems.parentId, parentId))
      .orderBy(libraryItems.seasonNumber, libraryItems.episodeNumber)
      .all()
      .map(mapLibraryItem);
  }

  updateState(
    id: string,
    acquisitionState: AcquisitionState,
  ): LibraryItem | undefined {
    const row = this.database.client
      .update(libraryItems)
      .set({ acquisitionState, updatedAt: this.clock.now().getTime() })
      .where(eq(libraryItems.id, id))
      .returning()
      .get();
    return row === undefined ? undefined : mapLibraryItem(row);
  }

  updateMonitorPolicy(
    id: string,
    monitorPolicy: MonitorPolicy,
  ): LibraryItem | undefined {
    const row = this.database.client
      .update(libraryItems)
      .set({ monitorPolicy, updatedAt: this.clock.now().getTime() })
      .where(eq(libraryItems.id, id))
      .returning()
      .get();
    return row === undefined ? undefined : mapLibraryItem(row);
  }

  updateMetadata(
    id: string,
    patch: {
      tmdbId?: number | null;
      title?: string;
      year?: number | null;
      posterUrl?: string | null;
      releaseDate?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): LibraryItem | undefined {
    const values: Partial<typeof libraryItems.$inferInsert> = {
      tmdbId: patch.tmdbId,
      title: patch.title,
      year: patch.year,
      posterUrl: patch.posterUrl,
      ...(patch.releaseDate === undefined
        ? {}
        : {
            releaseDate:
              patch.releaseDate === null ? null : Date.parse(patch.releaseDate),
          }),
      ...(patch.metadata === undefined
        ? {}
        : { metadataJson: JSON.stringify(patch.metadata) }),
      updatedAt: this.clock.now().getTime(),
    };
    const row = this.database.client
      .update(libraryItems)
      .set(values)
      .where(eq(libraryItems.id, id))
      .returning()
      .get();
    return row === undefined ? undefined : mapLibraryItem(row);
  }

  list(query: LibraryQuery): { items: LibraryItem[]; total: number } {
    const filters: SQL[] = [];
    if (query.search !== undefined && query.search !== "") {
      filters.push(
        sql`instr(lower(${libraryItems.title}), lower(${query.search})) > 0`,
      );
    }
    if (query.status !== undefined)
      filters.push(eq(libraryItems.acquisitionState, query.status));
    if (query.kind !== undefined)
      filters.push(eq(libraryItems.kind, query.kind));
    if (query.parentId !== undefined)
      filters.push(eq(libraryItems.parentId, query.parentId));
    if (query.monitorPolicy !== undefined)
      filters.push(eq(libraryItems.monitorPolicy, query.monitorPolicy));
    const where = filters.length === 0 ? undefined : and(...filters);
    const rows = this.database.client
      .select()
      .from(libraryItems)
      .where(where)
      .orderBy(desc(libraryItems.createdAt), desc(libraryItems.id))
      .limit(query.limit)
      .offset(query.offset)
      .all();
    const total = this.database.client
      .select({ count: sql<number>`count(*)` })
      .from(libraryItems)
      .where(where)
      .get()?.count;
    return { items: rows.map(mapLibraryItem), total: Number(total ?? 0) };
  }

  summarize(
    query: Pick<LibraryQuery, "kind" | "parentId" | "monitorPolicy">,
  ): LibrarySummary {
    const filters: SQL[] = [];
    if (query.kind !== undefined)
      filters.push(eq(libraryItems.kind, query.kind));
    if (query.parentId !== undefined)
      filters.push(eq(libraryItems.parentId, query.parentId));
    if (query.monitorPolicy !== undefined)
      filters.push(eq(libraryItems.monitorPolicy, query.monitorPolicy));
    const where = filters.length === 0 ? undefined : and(...filters);
    const row = this.database.client
      .select({
        total: sql<number>`count(*)`,
        downloaded: sql<number>`coalesce(sum(case when ${libraryItems.acquisitionState} = 'available' then 1 else 0 end), 0)`,
        active: sql<number>`coalesce(sum(case when ${libraryItems.acquisitionState} in ('searching', 'queued', 'downloading', 'organizing') then 1 else 0 end), 0)`,
        missing: sql<number>`coalesce(sum(case when ${libraryItems.acquisitionState} = 'missing' then 1 else 0 end), 0)`,
        failed: sql<number>`coalesce(sum(case when ${libraryItems.acquisitionState} = 'failed' then 1 else 0 end), 0)`,
      })
      .from(libraryItems)
      .where(where)
      .get();
    return {
      total: Number(row?.total ?? 0),
      downloaded: Number(row?.downloaded ?? 0),
      active: Number(row?.active ?? 0),
      missing: Number(row?.missing ?? 0),
      failed: Number(row?.failed ?? 0),
    };
  }

  /**
   * Loads every card's descendant files, episodes, and preferred download in
   * one SQLite query. A preferred download is the newest active transfer, or
   * the newest historical transfer when no active transfer exists.
   */
  cardProjections(
    rootIds: readonly string[],
  ): Map<string, LibraryCardProjection> {
    if (rootIds.length === 0) return new Map();
    const rootValues = rootIds.map(() => "(?)").join(", ");
    const now = this.clock.now().getTime();
    const rows = this.database.sqlite
      .query<LibraryCardProjectionRow, (string | number)[]>(`
        WITH RECURSIVE
          requested_roots(root_id) AS (VALUES ${rootValues}),
          media_tree(root_id, media_id) AS (
            SELECT root_id, root_id FROM requested_roots
            UNION ALL
            SELECT media_tree.root_id, child.id
            FROM media_items AS child
            JOIN media_tree ON child.parent_id = media_tree.media_id
          ),
          file_summary AS (
            SELECT
              media_tree.root_id AS root_id,
              min(library_files.path) AS library_path,
              count(library_files.id) AS file_count,
              coalesce(sum(library_files.size_bytes), 0) AS file_bytes,
              min(library_files.quality) AS quality
            FROM media_tree
            JOIN library_files ON library_files.media_item_id = media_tree.media_id
            GROUP BY media_tree.root_id
          ),
          episode_summary AS (
            SELECT
              media_tree.root_id AS root_id,
              coalesce(sum(case
                when media_items.kind = 'episode'
                  and media_items.monitor_policy <> 'none'
                  and media_items.acquisition_state = 'available'
                then 1 else 0 end), 0) AS episode_available,
              coalesce(sum(case
                when media_items.kind = 'episode'
                  and media_items.monitor_policy <> 'none'
                then 1 else 0 end), 0) AS episode_total,
              min(case
                when media_items.kind = 'episode'
                  and media_items.monitor_policy <> 'none'
                  and media_items.release_date >= ?
                then media_items.release_date else null end) AS next_air_at
            FROM media_tree
            JOIN media_items ON media_items.id = media_tree.media_id
            GROUP BY media_tree.root_id
          ),
          ranked_downloads AS (
            SELECT
              media_tree.root_id AS root_id,
              downloads.id AS download_id,
              downloads.external_id AS download_external_id,
              downloads.state AS download_state,
              downloads.progress AS download_progress,
              downloads.downloaded_bytes AS downloaded_bytes,
              downloads.total_bytes AS download_total_bytes,
              downloads.download_rate AS download_rate,
              downloads.upload_rate AS upload_rate,
              downloads.eta_seconds AS eta_seconds,
              downloads.download_path AS download_path,
              downloads.error AS download_error,
              case when downloads.state in (
                'queued', 'downloading', 'paused', 'checking', 'organizing'
              ) then 1 else 0 end AS download_active,
              row_number() over (
                partition by media_tree.root_id
                order by
                  case when downloads.state in (
                    'queued', 'downloading', 'paused', 'checking', 'organizing'
                  ) then 0 else 1 end,
                  downloads.updated_at desc,
                  downloads.id desc
              ) AS download_rank
            FROM media_tree
            JOIN downloads ON downloads.media_item_id = media_tree.media_id
            WHERE downloads.acquisition_state IS NULL
              OR downloads.acquisition_state <> 'removed'
          )
        SELECT
          requested_roots.root_id AS rootId,
          file_summary.library_path AS libraryPath,
          file_summary.file_count AS fileCount,
          file_summary.file_bytes AS fileBytes,
          file_summary.quality AS quality,
          episode_summary.episode_available AS episodeAvailable,
          episode_summary.episode_total AS episodeTotal,
          episode_summary.next_air_at AS nextAirAt,
          ranked_downloads.download_id AS downloadId,
          ranked_downloads.download_external_id AS downloadExternalId,
          ranked_downloads.download_state AS downloadState,
          ranked_downloads.download_progress AS downloadProgress,
          ranked_downloads.downloaded_bytes AS downloadedBytes,
          ranked_downloads.download_total_bytes AS downloadTotalBytes,
          ranked_downloads.download_rate AS downloadRate,
          ranked_downloads.upload_rate AS uploadRate,
          ranked_downloads.eta_seconds AS etaSeconds,
          ranked_downloads.download_path AS downloadPath,
          ranked_downloads.download_error AS downloadError,
          ranked_downloads.download_active AS downloadActive
        FROM requested_roots
        LEFT JOIN file_summary ON file_summary.root_id = requested_roots.root_id
        LEFT JOIN episode_summary ON episode_summary.root_id = requested_roots.root_id
        LEFT JOIN ranked_downloads
          ON ranked_downloads.root_id = requested_roots.root_id
          AND ranked_downloads.download_rank = 1
      `)
      .all(...rootIds, now);
    return new Map(
      rows.map((row) => {
        const download =
          row.downloadId === null || row.downloadState === null
            ? null
            : {
                id: row.downloadId,
                externalId: row.downloadExternalId,
                state: row.downloadState,
                progress: Number(row.downloadProgress ?? 0),
                downloadedBytes: Number(row.downloadedBytes ?? 0),
                totalBytes: Number(row.downloadTotalBytes ?? 0),
                downloadRate: Number(row.downloadRate ?? 0),
                uploadRate: Number(row.uploadRate ?? 0),
                etaSeconds: row.etaSeconds,
                downloadPath: row.downloadPath,
                error: row.downloadError,
                active: row.downloadActive === 1,
              };
        return [
          row.rootId,
          {
            rootId: row.rootId,
            libraryPath: row.libraryPath,
            fileCount: Number(row.fileCount ?? 0),
            totalBytes: Number(row.fileBytes ?? 0),
            quality: row.quality,
            episodeAvailable: Number(row.episodeAvailable ?? 0),
            episodeTotal: Number(row.episodeTotal ?? 0),
            nextAirAt: row.nextAirAt,
            download,
          },
        ];
      }),
    );
  }

  delete(id: string): boolean {
    return (
      this.database.client
        .delete(libraryItems)
        .where(eq(libraryItems.id, id))
        .returning({ id: libraryItems.id })
        .get() !== undefined
    );
  }

  count(): number {
    const row = this.database.client
      .select({ count: sql<number>`count(*)` })
      .from(libraryItems)
      .get();
    return Number(row?.count ?? 0);
  }
}

/** Canonical v1 name; LibraryRepository remains for API compatibility. */
export { LibraryRepository as MediaRepository };

export class CalendarRepository {
  constructor(
    private readonly database: BackendDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  create(input: CreateCalendarEventRequest): CalendarEvent {
    const now = this.clock.now().getTime();
    const scheduledAt = Date.parse(input.scheduledAt);
    try {
      if (input.kind === "release" && input.libraryItemId !== null) {
        const existing = this.database.client
          .select()
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.kind, "release"),
              eq(calendarEvents.libraryItemId, input.libraryItemId),
            ),
          )
          .orderBy(desc(calendarEvents.updatedAt))
          .get();
        if (existing !== undefined) {
          const updated = this.database.client
            .update(calendarEvents)
            .set({
              title: input.title,
              scheduledAt,
              status: input.status,
              metadataJson: JSON.stringify(input.metadata),
              updatedAt: now,
            })
            .where(eq(calendarEvents.id, existing.id))
            .returning()
            .get();
          return mapCalendarEvent(updated);
        }
      }
      const row = this.database.client
        .insert(calendarEvents)
        .values({
          id: crypto.randomUUID(),
          ...input,
          scheduledAt,
          metadataJson: JSON.stringify(input.metadata),
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      return mapCalendarEvent(row);
    } catch (error) {
      throw new AppError({
        code: "bad_request",
        message: "The referenced library item does not exist",
        status: 400,
        cause: error,
      });
    }
  }

  list(from: string, to: string): CalendarEvent[] {
    return this.database.client
      .select({
        event: calendarEvents,
        acquisitionState: libraryItems.acquisitionState,
        monitorPolicy: libraryItems.monitorPolicy,
      })
      .from(calendarEvents)
      .leftJoin(libraryItems, eq(calendarEvents.libraryItemId, libraryItems.id))
      .where(
        and(
          gte(calendarEvents.scheduledAt, Date.parse(from)),
          lte(calendarEvents.scheduledAt, Date.parse(to)),
        ),
      )
      .orderBy(calendarEvents.scheduledAt)
      .all()
      .filter(
        ({ event, monitorPolicy }) =>
          event.kind !== "release" ||
          (event.libraryItemId !== null && monitorPolicy !== "none"),
      )
      .map(({ event, acquisitionState }) => {
        const mapped = mapCalendarEvent(event);
        return acquisitionState === null
          ? mapped
          : {
              ...mapped,
              metadata: { ...mapped.metadata, acquisitionState },
            };
      });
  }

  deleteForLibraryItems(libraryItemIds: string[]): number {
    if (libraryItemIds.length === 0) return 0;
    return this.database.client
      .delete(calendarEvents)
      .where(inArray(calendarEvents.libraryItemId, libraryItemIds))
      .returning({ id: calendarEvents.id })
      .all().length;
  }
}

export class JobRepository {
  constructor(
    private readonly database: BackendDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  create(input: CreateJobRequest): Job {
    const now = this.clock.now().getTime();
    const row = this.database.client
      .insert(jobRecords)
      .values({
        id: crypto.randomUUID(),
        kind: input.kind,
        payloadJson: JSON.stringify(input.payload),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return mapJob(row);
  }

  get(id: string): Job | undefined {
    const row = this.database.client
      .select()
      .from(jobRecords)
      .where(eq(jobRecords.id, id))
      .get();
    return row === undefined ? undefined : mapJob(row);
  }

  list(query: {
    limit: number;
    offset: number;
    status?: JobStatus;
    kind?: string;
  }): {
    jobs: Job[];
    total: number;
  } {
    const predicates: SQL[] = [];
    if (query.status !== undefined) {
      predicates.push(eq(jobRecords.status, query.status));
    }
    if (query.kind !== undefined) {
      predicates.push(eq(jobRecords.kind, query.kind));
    }
    const where = predicates.length === 0 ? undefined : and(...predicates);
    const rows = this.database.client
      .select()
      .from(jobRecords)
      .where(where)
      .orderBy(desc(jobRecords.updatedAt), desc(jobRecords.id))
      .limit(query.limit)
      .offset(query.offset)
      .all();
    const total = this.database.client
      .select({ count: sql<number>`count(*)` })
      .from(jobRecords)
      .where(where)
      .get()?.count;
    return { jobs: rows.map(mapJob), total: Number(total ?? 0) };
  }

  count(status: JobStatus): number {
    const row = this.database.client
      .select({ count: sql<number>`count(*)` })
      .from(jobRecords)
      .where(eq(jobRecords.status, status))
      .get();
    return Number(row?.count ?? 0);
  }
}

export interface Repositories {
  auth: AuthRepository;
  settings: SettingsRepository;
  secrets: SecretRepository;
  library: LibraryRepository;
  media: LibraryRepository;
  calendar: CalendarRepository;
  jobs: JobRepository;
  releases: ReleaseCandidateRepository;
  downloads: DownloadRepository;
  libraryFiles: LibraryFileRepository;
  scanReviews: LibraryScanReviewRepository;
  activity: ActivityRepository;
  metadataCache: MetadataCacheRepository;
}

export function createRepositories(
  database: BackendDatabase,
  clock: Clock = systemClock,
): Repositories {
  const library = new LibraryRepository(database, clock);
  const repositories: Repositories = {
    auth: new AuthRepository(database),
    settings: new SettingsRepository(database, clock),
    secrets: new SecretRepository(database),
    library,
    media: library,
    calendar: new CalendarRepository(database, clock),
    jobs: new JobRepository(database, clock),
    releases: new ReleaseCandidateRepository(database, clock),
    downloads: new DownloadRepository(database, clock),
    libraryFiles: new LibraryFileRepository(database, clock),
    scanReviews: new LibraryScanReviewRepository(database, clock),
    activity: new ActivityRepository(database, clock),
    metadataCache: new MetadataCacheRepository(database, clock),
  };
  repositories.settings.ensureDefaults();
  return repositories;
}

export function toAdmin(row: AdminRow): Admin {
  return {
    id: row.id,
    username: row.username,
    createdAt: toIsoDate(row.createdAt),
    lastLoginAt: row.lastLoginAt === null ? null : toIsoDate(row.lastLoginAt),
  };
}

function mapLibraryItem(row: LibraryItemRow): LibraryItem {
  return {
    id: row.id,
    kind: row.kind,
    tmdbId: row.tmdbId,
    parentId: row.parentId,
    seasonNumber: row.seasonNumber,
    episodeNumber: row.episodeNumber,
    title: row.title,
    year: row.year,
    posterUrl: row.posterUrl,
    status: row.acquisitionState,
    monitorPolicy: row.monitorPolicy,
    acquisitionState: row.acquisitionState,
    releaseDate: row.releaseDate === null ? null : toIsoDate(row.releaseDate),
    metadata: parseJsonObject(row.metadataJson, "library metadata"),
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
  };
}

function mapCalendarEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    scheduledAt: toIsoDate(row.scheduledAt),
    libraryItemId: row.libraryItemId,
    status: row.status,
    metadata: parseJsonObject(row.metadataJson, "calendar metadata"),
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
  };
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    progress: row.progress,
    message: row.message,
    payload: parseJsonObject(row.payloadJson, "job payload"),
    result:
      row.resultJson === null
        ? null
        : parseJsonObject(row.resultJson, "job result"),
    error:
      row.errorJson === null
        ? null
        : parseJsonObject(row.errorJson, "job error"),
    attempt: row.startedAt === null ? 0 : 1,
    maxAttempts: 1,
    runAt: toIsoDate(row.createdAt),
    priority: 0,
    dedupeKey: null,
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
    startedAt: row.startedAt === null ? null : toIsoDate(row.startedAt),
    finishedAt: row.finishedAt === null ? null : toIsoDate(row.finishedAt),
  };
}
