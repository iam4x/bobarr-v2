CREATE TABLE `users` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`rank` text NOT NULL,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
INSERT INTO `users` (
	`id`, `username`, `password_hash`, `rank`, `failed_login_count`, `locked_until`,
	`created_at`, `updated_at`, `last_login_at`
)
SELECT
	`id`, `username`, `password_hash`, 'admin', `failed_login_count`, `locked_until`,
	`created_at`, `updated_at`, `last_login_at`
FROM `admins`;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);
--> statement-breakpoint
CREATE TABLE `sessions_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`csrf_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`revoked_at` integer,
	`user_agent` text,
	`ip_address` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `sessions_new` (
	`id`, `user_id`, `token_hash`, `csrf_hash`, `created_at`, `expires_at`,
	`last_seen_at`, `revoked_at`, `user_agent`, `ip_address`
)
SELECT
	`id`, `admin_id`, `token_hash`, `csrf_hash`, `created_at`, `expires_at`,
	`last_seen_at`, `revoked_at`, `user_agent`, `ip_address`
FROM `sessions`;
--> statement-breakpoint
DROP TABLE `sessions`;
--> statement-breakpoint
DROP TABLE `admins`;
--> statement-breakpoint
ALTER TABLE `sessions_new` RENAME TO `sessions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_index` ON `sessions` (`user_id`);
--> statement-breakpoint
CREATE INDEX `sessions_expires_at_index` ON `sessions` (`expires_at`);
--> statement-breakpoint
ALTER TABLE `media_items` ADD `created_by_user_id` integer DEFAULT 1 NOT NULL REFERENCES `users`(`id`);
--> statement-breakpoint
ALTER TABLE `downloads` ADD `requested_by_user_id` integer DEFAULT 1 NOT NULL REFERENCES `users`(`id`);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_by` integer,
	`accepted_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `invites_created_by_index` ON `invites` (`created_by`);
