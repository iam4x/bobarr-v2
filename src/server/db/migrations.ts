import type { Database } from "bun:sqlite";

import { AppError } from "../core";

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "initial_backend",
    sql: `
      CREATE TABLE admins (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        failed_login_count INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login_at INTEGER
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        csrf_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        revoked_at INTEGER,
        user_agent TEXT,
        ip_address TEXT
      );
      CREATE INDEX sessions_admin_id_index ON sessions(admin_id);
      CREATE INDEX sessions_expires_at_index ON sessions(expires_at);
      CREATE TABLE app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        value TEXT NOT NULL,
        version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE encrypted_secrets (
        name TEXT PRIMARY KEY,
        ciphertext TEXT NOT NULL,
        nonce TEXT NOT NULL,
        key_version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE library_items (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('movie', 'series')),
        title TEXT NOT NULL,
        year INTEGER,
        poster_url TEXT,
        status TEXT NOT NULL DEFAULT 'wanted' CHECK (status IN ('wanted', 'searching', 'downloading', 'available', 'failed')),
        release_date INTEGER,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX library_items_status_index ON library_items(status);
      CREATE INDEX library_items_kind_index ON library_items(kind);
      CREATE INDEX library_items_release_date_index ON library_items(release_date);
      CREATE TABLE calendar_events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('release', 'download', 'reminder')),
        scheduled_at INTEGER NOT NULL,
        library_item_id TEXT REFERENCES library_items(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX calendar_events_scheduled_at_index ON calendar_events(scheduled_at);
      CREATE INDEX calendar_events_library_item_id_index ON calendar_events(library_item_id);
      CREATE TABLE job_records (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
        message TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT,
        error_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER
      );
      CREATE INDEX job_records_status_index ON job_records(status);
      CREATE INDEX job_records_updated_at_index ON job_records(updated_at);
    `,
  },
  {
    version: 2,
    name: "core_vertical_slice",
    sql: `
      CREATE TABLE media_items (
        id TEXT PRIMARY KEY,
        tmdb_id INTEGER,
        kind TEXT NOT NULL CHECK (kind IN ('movie', 'series', 'season', 'episode')),
        parent_id TEXT REFERENCES media_items(id) ON DELETE CASCADE,
        season_number INTEGER CHECK (season_number IS NULL OR season_number >= 0),
        episode_number INTEGER CHECK (episode_number IS NULL OR episode_number >= 0),
        title TEXT NOT NULL,
        year INTEGER,
        poster_url TEXT,
        monitor_policy TEXT NOT NULL DEFAULT 'all' CHECK (monitor_policy IN ('none', 'selected', 'all', 'future')),
        acquisition_state TEXT NOT NULL DEFAULT 'missing' CHECK (acquisition_state IN ('unmonitored', 'missing', 'searching', 'queued', 'downloading', 'organizing', 'available', 'failed')),
        release_date INTEGER,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO media_items (
        id, kind, title, year, poster_url, monitor_policy, acquisition_state,
        release_date, metadata_json, created_at, updated_at
      )
      SELECT
        id, kind, title, year, poster_url, 'all',
        CASE status WHEN 'wanted' THEN 'missing' ELSE status END,
        release_date, metadata_json, created_at, updated_at
      FROM library_items;
      CREATE UNIQUE INDEX media_items_kind_tmdb_id_unique ON media_items(kind, tmdb_id);
      CREATE INDEX media_items_parent_id_index ON media_items(parent_id);
      CREATE INDEX media_items_acquisition_state_index ON media_items(acquisition_state);
      CREATE INDEX media_items_monitor_policy_index ON media_items(monitor_policy);
      CREATE INDEX media_items_kind_index ON media_items(kind);
      CREATE INDEX media_items_release_date_index ON media_items(release_date);

      CREATE TABLE calendar_events_v2 (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('release', 'download', 'reminder')),
        scheduled_at INTEGER NOT NULL,
        library_item_id TEXT REFERENCES media_items(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO calendar_events_v2 SELECT * FROM calendar_events;
      DROP TABLE calendar_events;
      DROP TABLE library_items;
      ALTER TABLE calendar_events_v2 RENAME TO calendar_events;
      CREATE INDEX calendar_events_scheduled_at_index ON calendar_events(scheduled_at);
      CREATE INDEX calendar_events_library_item_id_index ON calendar_events(library_item_id);

      CREATE TABLE release_candidates (
        id TEXT PRIMARY KEY,
        media_item_id TEXT REFERENCES media_items(id) ON DELETE CASCADE,
        tmdb_id INTEGER,
        media_kind TEXT NOT NULL CHECK (media_kind IN ('movie', 'series', 'season', 'episode')),
        title TEXT NOT NULL,
        indexer TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        seeders INTEGER NOT NULL CHECK (seeders >= 0),
        leechers INTEGER NOT NULL CHECK (leechers >= 0),
        published_at INTEGER,
        quality TEXT,
        score REAL NOT NULL,
        eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
        reasons_json TEXT NOT NULL DEFAULT '[]',
        protected_source_payload TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX release_candidates_media_item_id_index ON release_candidates(media_item_id);
      CREATE INDEX release_candidates_target_index ON release_candidates(media_kind, tmdb_id);
      CREATE INDEX release_candidates_expires_at_index ON release_candidates(expires_at);

      CREATE TABLE downloads (
        id TEXT PRIMARY KEY,
        media_item_id TEXT REFERENCES media_items(id) ON DELETE SET NULL,
        release_candidate_id TEXT REFERENCES release_candidates(id) ON DELETE SET NULL,
        client TEXT NOT NULL,
        external_id TEXT,
        title TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'downloading', 'paused', 'checking', 'seeding', 'organizing', 'completed', 'failed')),
        progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
        downloaded_bytes INTEGER NOT NULL DEFAULT 0 CHECK (downloaded_bytes >= 0),
        total_bytes INTEGER NOT NULL DEFAULT 0 CHECK (total_bytes >= 0),
        download_rate INTEGER NOT NULL DEFAULT 0 CHECK (download_rate >= 0),
        upload_rate INTEGER NOT NULL DEFAULT 0 CHECK (upload_rate >= 0),
        eta_seconds INTEGER,
        download_path TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE UNIQUE INDEX downloads_client_external_id_unique ON downloads(client, external_id);
      CREATE INDEX downloads_media_item_id_index ON downloads(media_item_id);
      CREATE INDEX downloads_state_index ON downloads(state);
      CREATE INDEX downloads_updated_at_index ON downloads(updated_at);

      CREATE TABLE library_files (
        id TEXT PRIMARY KEY,
        media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
        download_id TEXT REFERENCES downloads(id) ON DELETE SET NULL,
        path TEXT NOT NULL UNIQUE,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        quality TEXT,
        video_codec TEXT,
        audio_codec TEXT,
        strategy TEXT NOT NULL CHECK (strategy IN ('hardlink', 'symlink', 'copy', 'move')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX library_files_media_item_id_index ON library_files(media_item_id);
      CREATE INDEX library_files_download_id_index ON library_files(download_id);

      CREATE TABLE activity_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'success', 'warning', 'error')),
        message TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX activity_events_created_at_index ON activity_events(created_at);
      CREATE INDEX activity_events_entity_index ON activity_events(entity_type, entity_id);
      CREATE INDEX activity_events_level_index ON activity_events(level);

      CREATE TABLE metadata_cache (
        provider TEXT NOT NULL,
        media_kind TEXT NOT NULL CHECK (media_kind IN ('movie', 'series', 'season', 'episode')),
        external_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        value_json TEXT NOT NULL,
        etag TEXT,
        fetched_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (provider, media_kind, external_id, locale)
      );
      CREATE INDEX metadata_cache_expires_at_index ON metadata_cache(expires_at);
    `,
  },
  {
    version: 3,
    name: "durable_acquisition_downloads",
    sql: `
      ALTER TABLE downloads ADD COLUMN acquisition_state TEXT
        CHECK (acquisition_state IS NULL OR acquisition_state IN ('queued', 'submitting', 'downloading', 'paused', 'completed', 'organizing', 'organized', 'missing', 'failed', 'removed'));
      ALTER TABLE downloads ADD COLUMN target_json TEXT;
      ALTER TABLE downloads ADD COLUMN source_ciphertext TEXT;
      ALTER TABLE downloads ADD COLUMN expected_info_hash TEXT;
      ALTER TABLE downloads ADD COLUMN engine_info_hash TEXT;
      ALTER TABLE downloads ADD COLUMN engine_name TEXT;
      ALTER TABLE downloads ADD COLUMN engine_label TEXT;
      ALTER TABLE downloads ADD COLUMN download_directory TEXT;
      ALTER TABLE downloads ADD COLUMN acquisition_progress REAL NOT NULL DEFAULT 0
        CHECK (acquisition_progress >= 0 AND acquisition_progress <= 1);
      ALTER TABLE downloads ADD COLUMN paused_requested INTEGER NOT NULL DEFAULT 0
        CHECK (paused_requested IN (0, 1));
      ALTER TABLE downloads ADD COLUMN peer_limit INTEGER
        CHECK (peer_limit IS NULL OR peer_limit > 0);
      ALTER TABLE downloads ADD COLUMN last_engine_seen_at INTEGER;

      CREATE INDEX downloads_acquisition_state_index ON downloads(acquisition_state);
      CREATE UNIQUE INDEX downloads_engine_label_unique ON downloads(engine_label);
      CREATE INDEX downloads_engine_info_hash_index ON downloads(engine_info_hash);
    `,
  },
  {
    version: 4,
    name: "library_scan_reviews",
    sql: `
      CREATE TABLE library_scan_reviews (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('movie', 'series')),
        title TEXT NOT NULL,
        year INTEGER CHECK (year IS NULL OR (year >= 1870 AND year <= 3000)),
        root_path TEXT NOT NULL,
        files_json TEXT NOT NULL,
        candidates_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'resolved', 'dismissed')),
        resolved_tmdb_id INTEGER,
        media_item_id TEXT REFERENCES media_items(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        resolved_at INTEGER
      );
      CREATE UNIQUE INDEX library_scan_reviews_fingerprint_unique
        ON library_scan_reviews(fingerprint);
      CREATE INDEX library_scan_reviews_status_index
        ON library_scan_reviews(status, updated_at);
      CREATE INDEX library_scan_reviews_media_item_id_index
        ON library_scan_reviews(media_item_id);
    `,
  },
  {
    version: 5,
    name: "release_removed_download_identity",
    sql: `
      UPDATE downloads
      SET external_id = NULL
      WHERE acquisition_state = 'removed';
    `,
  },
];

export const LATEST_DATABASE_MIGRATION =
  migrations[migrations.length - 1]?.version ?? 0;

/**
 * Validate that an existing database was created by Bobarr and has an
 * unmodified, contiguous migration history. This is intentionally read-only
 * so it can be used to vet a restore image before it is allowed near the live
 * database.
 */
export function verifyMigrationHistory(database: Database): number {
  const table = database
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get("schema_migrations");
  if (table === null) throw new Error("Not a Bobarr database backup");

  const rows = database
    .query<{ version: number; name: string; hash: string }, []>(
      "SELECT version, name, hash FROM schema_migrations ORDER BY version",
    )
    .all();
  if (rows.length === 0) throw new Error("Bobarr migration history is empty");

  for (const [index, row] of rows.entries()) {
    const expected = migrations[index];
    if (
      expected === undefined ||
      row.version !== expected.version ||
      row.name !== expected.name ||
      row.hash !== migrationHash(expected)
    ) {
      throw new Error("Bobarr migration history is invalid or unsupported");
    }
  }
  return rows.at(-1)?.version ?? 0;
}

function migrationHash(migration: Migration): string {
  return new Bun.CryptoHasher("sha256")
    .update(`${migration.version}:${migration.name}:${migration.sql}`)
    .digest("hex");
}

export function runMigrations(database: Database): number {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      hash TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const appliedRows = database
    .query<{ version: number; hash: string }, []>(
      "SELECT version, hash FROM schema_migrations",
    )
    .all();
  const applied = new Map(appliedRows.map((row) => [row.version, row.hash]));

  for (const migration of migrations) {
    const hash = migrationHash(migration);
    const existingHash = applied.get(migration.version);
    if (existingHash !== undefined) {
      if (existingHash !== hash) {
        throw new AppError({
          code: "internal_error",
          message: `Migration ${migration.version} was modified after being applied`,
          status: 500,
        });
      }
      continue;
    }

    database.transaction(() => {
      database.exec(migration.sql);
      database
        .query(
          "INSERT INTO schema_migrations (version, name, hash, applied_at) VALUES (?, ?, ?, ?)",
        )
        .run(migration.version, migration.name, hash, Date.now());
    })();
  }

  return getMigrationVersion(database);
}

export function getMigrationVersion(database: Database): number {
  const row = database
    .query<{ version: number | null }, []>(
      "SELECT MAX(version) AS version FROM schema_migrations",
    )
    .get();
  return row?.version ?? 0;
}
