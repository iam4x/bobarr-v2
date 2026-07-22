CREATE TABLE `library_scan_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`year` integer,
	`root_path` text NOT NULL,
	`files_json` text NOT NULL,
	`candidates_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`resolved_tmdb_id` integer,
	`media_item_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_scan_reviews_fingerprint_unique` ON `library_scan_reviews` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `library_scan_reviews_status_index` ON `library_scan_reviews` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `library_scan_reviews_media_item_id_index` ON `library_scan_reviews` (`media_item_id`);
