ALTER TABLE `downloads` ADD `acquisition_state` text;--> statement-breakpoint
ALTER TABLE `downloads` ADD `target_json` text;--> statement-breakpoint
ALTER TABLE `downloads` ADD `source_ciphertext` text;--> statement-breakpoint
ALTER TABLE `downloads` ADD `expected_info_hash` text;--> statement-breakpoint
ALTER TABLE `downloads` ADD `engine_info_hash` text;--> statement-breakpoint
ALTER TABLE `downloads` ADD `engine_name` text;--> statement-breakpoint
ALTER TABLE `downloads` ADD `engine_label` text;--> statement-breakpoint
ALTER TABLE `downloads` ADD `download_directory` text;--> statement-breakpoint
ALTER TABLE `downloads` ADD `acquisition_progress` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `downloads` ADD `paused_requested` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `downloads` ADD `peer_limit` integer;--> statement-breakpoint
ALTER TABLE `downloads` ADD `last_engine_seen_at` integer;--> statement-breakpoint
CREATE INDEX `downloads_acquisition_state_index` ON `downloads` (`acquisition_state`);--> statement-breakpoint
CREATE UNIQUE INDEX `downloads_engine_label_unique` ON `downloads` (`engine_label`);--> statement-breakpoint
CREATE INDEX `downloads_engine_info_hash_index` ON `downloads` (`engine_info_hash`);