import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const admins = sqliteTable(
  "admins",
  {
    id: integer("id").primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: integer("locked_until"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastLoginAt: integer("last_login_at"),
  },
  (table) => [uniqueIndex("admins_username_unique").on(table.username)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    adminId: integer("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    csrfHash: text("csrf_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    revokedAt: integer("revoked_at"),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_admin_id_index").on(table.adminId),
    index("sessions_expires_at_index").on(table.expiresAt),
  ],
);

export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey(),
  value: text("value").notNull(),
  version: integer("version").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const encryptedSecrets = sqliteTable("encrypted_secrets", {
  name: text("name").primaryKey(),
  ciphertext: text("ciphertext").notNull(),
  nonce: text("nonce").notNull(),
  keyVersion: integer("key_version").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const mediaItems = sqliteTable(
  "media_items",
  {
    id: text("id").primaryKey(),
    tmdbId: integer("tmdb_id"),
    kind: text("kind", {
      enum: ["movie", "series", "season", "episode"],
    }).notNull(),
    parentId: text("parent_id").references(
      (): AnySQLiteColumn => mediaItems.id,
      {
        onDelete: "cascade",
      },
    ),
    seasonNumber: integer("season_number"),
    episodeNumber: integer("episode_number"),
    title: text("title").notNull(),
    year: integer("year"),
    posterUrl: text("poster_url"),
    monitorPolicy: text("monitor_policy", {
      enum: ["none", "selected", "all", "future"],
    })
      .notNull()
      .default("all"),
    acquisitionState: text("acquisition_state", {
      enum: [
        "unmonitored",
        "missing",
        "searching",
        "queued",
        "downloading",
        "organizing",
        "available",
        "failed",
      ],
    })
      .notNull()
      .default("missing"),
    releaseDate: integer("release_date"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("media_items_kind_tmdb_id_unique").on(table.kind, table.tmdbId),
    index("media_items_parent_id_index").on(table.parentId),
    index("media_items_acquisition_state_index").on(table.acquisitionState),
    index("media_items_monitor_policy_index").on(table.monitorPolicy),
    index("media_items_kind_index").on(table.kind),
    index("media_items_release_date_index").on(table.releaseDate),
  ],
);

/** @deprecated Use mediaItems. Kept as an import-compatible alias for the v1 API. */
export const libraryItems = mediaItems;

export const calendarEvents = sqliteTable(
  "calendar_events",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    kind: text("kind", { enum: ["release", "download", "reminder"] }).notNull(),
    scheduledAt: integer("scheduled_at").notNull(),
    libraryItemId: text("library_item_id").references(() => mediaItems.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: ["scheduled", "completed", "cancelled"] })
      .notNull()
      .default("scheduled"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("calendar_events_scheduled_at_index").on(table.scheduledAt),
    index("calendar_events_library_item_id_index").on(table.libraryItemId),
  ],
);

export const jobRecords = sqliteTable(
  "job_records",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("queued"),
    progress: integer("progress").notNull().default(0),
    message: text("message"),
    payloadJson: text("payload_json").notNull().default("{}"),
    resultJson: text("result_json"),
    errorJson: text("error_json"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
  },
  (table) => [
    index("job_records_status_index").on(table.status),
    index("job_records_updated_at_index").on(table.updatedAt),
  ],
);

export const releaseCandidates = sqliteTable(
  "release_candidates",
  {
    id: text("id").primaryKey(),
    mediaItemId: text("media_item_id").references(() => mediaItems.id, {
      onDelete: "cascade",
    }),
    tmdbId: integer("tmdb_id"),
    mediaKind: text("media_kind", {
      enum: ["movie", "series", "season", "episode"],
    }).notNull(),
    title: text("title").notNull(),
    indexer: text("indexer").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    seeders: integer("seeders").notNull(),
    leechers: integer("leechers").notNull(),
    publishedAt: integer("published_at"),
    quality: text("quality"),
    score: real("score").notNull(),
    eligible: integer("eligible", { mode: "boolean" }).notNull(),
    reasonsJson: text("reasons_json").notNull().default("[]"),
    protectedSourcePayload: text("protected_source_payload").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("release_candidates_media_item_id_index").on(table.mediaItemId),
    index("release_candidates_target_index").on(table.mediaKind, table.tmdbId),
    index("release_candidates_expires_at_index").on(table.expiresAt),
  ],
);

export const downloads = sqliteTable(
  "downloads",
  {
    id: text("id").primaryKey(),
    mediaItemId: text("media_item_id").references(() => mediaItems.id, {
      onDelete: "set null",
    }),
    releaseCandidateId: text("release_candidate_id").references(
      () => releaseCandidates.id,
      {
        onDelete: "set null",
      },
    ),
    client: text("client").notNull(),
    externalId: text("external_id"),
    title: text("title").notNull(),
    state: text("state", {
      enum: [
        "queued",
        "downloading",
        "paused",
        "checking",
        "seeding",
        "organizing",
        "completed",
        "failed",
      ],
    })
      .notNull()
      .default("queued"),
    progress: real("progress").notNull().default(0),
    downloadedBytes: integer("downloaded_bytes").notNull().default(0),
    totalBytes: integer("total_bytes").notNull().default(0),
    downloadRate: integer("download_rate").notNull().default(0),
    uploadRate: integer("upload_rate").notNull().default(0),
    etaSeconds: integer("eta_seconds"),
    downloadPath: text("download_path"),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    completedAt: integer("completed_at"),
    /**
     * Durable acquisition fields are intentionally separate from the public
     * progress/state projection above. Existing API consumers continue to see
     * a compact Transmission-oriented model while the application layer can
     * recover every in-flight side effect after a restart.
     */
    acquisitionState: text("acquisition_state", {
      enum: [
        "queued",
        "submitting",
        "downloading",
        "paused",
        "completed",
        "organizing",
        "organized",
        "missing",
        "failed",
        "removed",
      ],
    }),
    targetJson: text("target_json"),
    sourceCiphertext: text("source_ciphertext"),
    expectedInfoHash: text("expected_info_hash"),
    engineInfoHash: text("engine_info_hash"),
    engineName: text("engine_name"),
    engineLabel: text("engine_label"),
    downloadDirectory: text("download_directory"),
    acquisitionProgress: real("acquisition_progress").notNull().default(0),
    pausedRequested: integer("paused_requested", { mode: "boolean" })
      .notNull()
      .default(false),
    peerLimit: integer("peer_limit"),
    lastEngineSeenAt: integer("last_engine_seen_at"),
  },
  (table) => [
    uniqueIndex("downloads_client_external_id_unique").on(
      table.client,
      table.externalId,
    ),
    index("downloads_media_item_id_index").on(table.mediaItemId),
    index("downloads_state_index").on(table.state),
    index("downloads_updated_at_index").on(table.updatedAt),
    index("downloads_acquisition_state_index").on(table.acquisitionState),
    uniqueIndex("downloads_engine_label_unique").on(table.engineLabel),
    index("downloads_engine_info_hash_index").on(table.engineInfoHash),
  ],
);

export const libraryFiles = sqliteTable(
  "library_files",
  {
    id: text("id").primaryKey(),
    mediaItemId: text("media_item_id")
      .notNull()
      .references(() => mediaItems.id, { onDelete: "cascade" }),
    downloadId: text("download_id").references(() => downloads.id, {
      onDelete: "set null",
    }),
    path: text("path").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    quality: text("quality"),
    videoCodec: text("video_codec"),
    audioCodec: text("audio_codec"),
    strategy: text("strategy", {
      enum: ["hardlink", "symlink", "copy", "move"],
    }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("library_files_path_unique").on(table.path),
    index("library_files_media_item_id_index").on(table.mediaItemId),
    index("library_files_download_id_index").on(table.downloadId),
  ],
);

export const activityEvents = sqliteTable(
  "activity_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    level: text("level", { enum: ["info", "success", "warning", "error"] })
      .notNull()
      .default("info"),
    message: text("message").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    dataJson: text("data_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("activity_events_created_at_index").on(table.createdAt),
    index("activity_events_entity_index").on(table.entityType, table.entityId),
    index("activity_events_level_index").on(table.level),
  ],
);

export const metadataCache = sqliteTable(
  "metadata_cache",
  {
    provider: text("provider").notNull(),
    mediaKind: text("media_kind", {
      enum: ["movie", "series", "season", "episode"],
    }).notNull(),
    externalId: text("external_id").notNull(),
    locale: text("locale").notNull(),
    valueJson: text("value_json").notNull(),
    etag: text("etag"),
    fetchedAt: integer("fetched_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "metadata_cache_primary_key",
      columns: [
        table.provider,
        table.mediaKind,
        table.externalId,
        table.locale,
      ],
    }),
    index("metadata_cache_expires_at_index").on(table.expiresAt),
  ],
);

export const libraryScanReviews = sqliteTable(
  "library_scan_reviews",
  {
    id: text("id").primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    kind: text("kind", { enum: ["movie", "series"] }).notNull(),
    title: text("title").notNull(),
    year: integer("year"),
    rootPath: text("root_path").notNull(),
    filesJson: text("files_json").notNull(),
    candidatesJson: text("candidates_json").notNull().default("[]"),
    status: text("status", {
      enum: ["pending", "resolved", "dismissed"],
    })
      .notNull()
      .default("pending"),
    resolvedTmdbId: integer("resolved_tmdb_id"),
    mediaItemId: text("media_item_id").references(() => mediaItems.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (table) => [
    uniqueIndex("library_scan_reviews_fingerprint_unique").on(
      table.fingerprint,
    ),
    index("library_scan_reviews_status_index").on(
      table.status,
      table.updatedAt,
    ),
    index("library_scan_reviews_media_item_id_index").on(table.mediaItemId),
  ],
);

export const databaseSchema = {
  admins,
  sessions,
  appSettings,
  encryptedSecrets,
  mediaItems,
  calendarEvents,
  jobRecords,
  releaseCandidates,
  downloads,
  libraryFiles,
  activityEvents,
  metadataCache,
  libraryScanReviews,
};

export type DatabaseSchema = typeof databaseSchema;
