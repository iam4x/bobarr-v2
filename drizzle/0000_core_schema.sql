-- Drizzle bootstrap for new databases. The bundled runtime uses the equivalent,
-- checksummed migrations in src/server/db/migrations.ts so deployment does not
-- depend on loose SQL files.
CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`data_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_events_created_at_index` ON `activity_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `activity_events_entity_index` ON `activity_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `activity_events_level_index` ON `activity_events` (`level`);--> statement-breakpoint
CREATE TABLE `admins` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admins_username_unique` ON `admins` (`username`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`library_item_id` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`library_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `calendar_events_scheduled_at_index` ON `calendar_events` (`scheduled_at`);--> statement-breakpoint
CREATE INDEX `calendar_events_library_item_id_index` ON `calendar_events` (`library_item_id`);--> statement-breakpoint
CREATE TABLE `downloads` (
	`id` text PRIMARY KEY NOT NULL,
	`media_item_id` text,
	`release_candidate_id` text,
	`client` text NOT NULL,
	`external_id` text,
	`title` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`downloaded_bytes` integer DEFAULT 0 NOT NULL,
	`total_bytes` integer DEFAULT 0 NOT NULL,
	`download_rate` integer DEFAULT 0 NOT NULL,
	`upload_rate` integer DEFAULT 0 NOT NULL,
	`eta_seconds` integer,
	`download_path` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`release_candidate_id`) REFERENCES `release_candidates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `downloads_client_external_id_unique` ON `downloads` (`client`,`external_id`);--> statement-breakpoint
CREATE INDEX `downloads_media_item_id_index` ON `downloads` (`media_item_id`);--> statement-breakpoint
CREATE INDEX `downloads_state_index` ON `downloads` (`state`);--> statement-breakpoint
CREATE INDEX `downloads_updated_at_index` ON `downloads` (`updated_at`);--> statement-breakpoint
CREATE TABLE `encrypted_secrets` (
	`name` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`nonce` text NOT NULL,
	`key_version` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_records` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`message` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`result_json` text,
	`error_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `job_records_status_index` ON `job_records` (`status`);--> statement-breakpoint
CREATE INDEX `job_records_updated_at_index` ON `job_records` (`updated_at`);--> statement-breakpoint
CREATE TABLE `library_files` (
	`id` text PRIMARY KEY NOT NULL,
	`media_item_id` text NOT NULL,
	`download_id` text,
	`path` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`quality` text,
	`video_codec` text,
	`audio_codec` text,
	`strategy` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`download_id`) REFERENCES `downloads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_files_path_unique` ON `library_files` (`path`);--> statement-breakpoint
CREATE INDEX `library_files_media_item_id_index` ON `library_files` (`media_item_id`);--> statement-breakpoint
CREATE INDEX `library_files_download_id_index` ON `library_files` (`download_id`);--> statement-breakpoint
CREATE TABLE `media_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tmdb_id` integer,
	`kind` text NOT NULL,
	`parent_id` text,
	`season_number` integer,
	`episode_number` integer,
	`title` text NOT NULL,
	`year` integer,
	`poster_url` text,
	`monitor_policy` text DEFAULT 'all' NOT NULL,
	`acquisition_state` text DEFAULT 'missing' NOT NULL,
	`release_date` integer,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_items_kind_tmdb_id_unique` ON `media_items` (`kind`,`tmdb_id`);--> statement-breakpoint
CREATE INDEX `media_items_parent_id_index` ON `media_items` (`parent_id`);--> statement-breakpoint
CREATE INDEX `media_items_acquisition_state_index` ON `media_items` (`acquisition_state`);--> statement-breakpoint
CREATE INDEX `media_items_monitor_policy_index` ON `media_items` (`monitor_policy`);--> statement-breakpoint
CREATE INDEX `media_items_kind_index` ON `media_items` (`kind`);--> statement-breakpoint
CREATE INDEX `media_items_release_date_index` ON `media_items` (`release_date`);--> statement-breakpoint
CREATE TABLE `metadata_cache` (
	`provider` text NOT NULL,
	`media_kind` text NOT NULL,
	`external_id` text NOT NULL,
	`locale` text NOT NULL,
	`value_json` text NOT NULL,
	`etag` text,
	`fetched_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`provider`, `media_kind`, `external_id`, `locale`)
);
--> statement-breakpoint
CREATE INDEX `metadata_cache_expires_at_index` ON `metadata_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `release_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`media_item_id` text,
	`tmdb_id` integer,
	`media_kind` text NOT NULL,
	`title` text NOT NULL,
	`indexer` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`seeders` integer NOT NULL,
	`leechers` integer NOT NULL,
	`published_at` integer,
	`quality` text,
	`score` real NOT NULL,
	`eligible` integer NOT NULL,
	`reasons_json` text DEFAULT '[]' NOT NULL,
	`protected_source_payload` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `release_candidates_media_item_id_index` ON `release_candidates` (`media_item_id`);--> statement-breakpoint
CREATE INDEX `release_candidates_target_index` ON `release_candidates` (`media_kind`,`tmdb_id`);--> statement-breakpoint
CREATE INDEX `release_candidates_expires_at_index` ON `release_candidates` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`csrf_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`revoked_at` integer,
	`user_agent` text,
	`ip_address` text,
	FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_admin_id_index` ON `sessions` (`admin_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_index` ON `sessions` (`expires_at`);
