-- The sigil family is destroyed and rebuilt. The DROPs below are deliberate.
--
-- WHY THEY ARE SAFE ON D1 (which ignores `PRAGMA foreign_keys=OFF`, so every
-- `DROP TABLE` fires ON DELETE CASCADE for real):
--
--   `sigils` is a CHILD of `campaigns` (sigils.campaign_id -> campaigns.id
--   ON DELETE CASCADE) and of `users` (created_by, ON DELETE SET NULL).
--   Dropping a table performs an implicit DELETE FROM, which fires FK actions
--   only where the dropped table is the PARENT. `sigils`' only children are
--   the `sigil_*` tables, and every one of them is dropped first, above it.
--   `campaign_sources` and `blights` are parents of nothing.
--
--   So no cascade edge leaves this family: `campaigns`, `quests`, `folios`,
--   `members`, `petitions`, `users`, `chapters`, `invitations` and the archive
--   tables are unreachable from any statement in this file. Verified against
--   the entity sources (`grep -rn "sigils.cols.id" src/api/entities/`) and
--   against the deployed baseline DDL: every REFERENCES of `sigils` in the
--   schema comes from the sigil family itself or from `blights`.
--
--   The drop order is therefore children-before-parents: the four old
--   `sigil_*` children, then `blights` (which will reference `sigils` once
--   rebuilt), then `campaign_sources`, and only then `sigils` itself, by which
--   point it has no children left to cascade into.
--
-- WHY THE DATA IS NOT MIGRATED:
--
--   Analytics history is discarded on purpose. It is best-effort counter data
--   with no production consumer, and the new tables aggregate on different
--   keys (hour instead of day, bucket histograms instead of raw samples) — a
--   rewrite, not a rename. `blights` is young and holds no rows worth keeping,
--   and its `source_id` becomes a real, constrained `sigil_id`.
--
--   Quests and folios are the data that matters and this migration does not
--   touch them.
--
-- WHY IT IS HAND-ORDERED RATHER THAN AS GENERATED:
--
--   drizzle-kit emitted `ALTER TABLE sigils ADD <col> NOT NULL` for the five
--   new columns. SQLite rejects adding a NOT NULL column without a default,
--   and the surviving rows carry no token under the new credential model
--   anyway. `snapshot.json` beside this file is the generator's output,
--   byte-for-byte — only the SQL is hand-ordered.

DROP TABLE IF EXISTS `sigil_blight_rate`;--> statement-breakpoint
DROP TABLE IF EXISTS `sigil_blights`;--> statement-breakpoint
DROP TABLE IF EXISTS `sigil_unique_visitors`;--> statement-breakpoint
DROP TABLE IF EXISTS `sigil_views`;--> statement-breakpoint
DROP TABLE IF EXISTS `sigil_vitals`;--> statement-breakpoint
DROP TABLE IF EXISTS `blights`;--> statement-breakpoint
DROP TABLE IF EXISTS `campaign_sources`;--> statement-breakpoint
DROP TABLE IF EXISTS `sigils`;--> statement-breakpoint
CREATE TABLE `sigils` (
	`id` text PRIMARY KEY,
	`campaign_id` integer NOT NULL,
	`app` text NOT NULL,
	`environment` text NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`kinds` text DEFAULT '[]' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_seen_at` text,
	CONSTRAINT `fk_sigils_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sigils_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `blights` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`campaign_id` integer NOT NULL,
	`sigil_id` text,
	`fingerprint` text NOT NULL,
	`name` text NOT NULL,
	`message` text NOT NULL,
	`stack` text DEFAULT '' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`origin` text DEFAULT 'client' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	CONSTRAINT `fk_blights_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_blights_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `sigil_views_hourly` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`sigil_id` text NOT NULL,
	`hour` text NOT NULL,
	`path` text NOT NULL,
	`country` text DEFAULT 'ZZ' NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `fk_sigil_views_hourly_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sigil_vitals_hourly` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`sigil_id` text NOT NULL,
	`hour` text NOT NULL,
	`metric` text NOT NULL,
	`path` text NOT NULL,
	`bucket_counts` text DEFAULT '{}' NOT NULL,
	CONSTRAINT `fk_sigil_vitals_hourly_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sigil_uniques_daily` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`sigil_id` text NOT NULL,
	`day` text NOT NULL,
	`visitor_hash` text NOT NULL,
	CONSTRAINT `fk_sigil_uniques_daily_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sigil_error_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`sigil_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`name` text NOT NULL,
	`message` text NOT NULL,
	`stack_sample` text NOT NULL,
	`source_url` text NOT NULL,
	`origin` text DEFAULT 'client' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `fk_sigil_error_groups_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `sigils_campaign_id_idx` ON `sigils` (`campaign_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sigils_token_hash_idx` ON `sigils` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `sigils_campaign_id_app_environment_idx` ON `sigils` (`campaign_id`,`app`,`environment`);--> statement-breakpoint
CREATE INDEX `sigils_created_by_idx` ON `sigils` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `blights_campaign_id_fingerprint_idx` ON `blights` (`campaign_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `blights_campaign_id_last_seen_at_idx` ON `blights` (`campaign_id`,`last_seen_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sigil_views_hourly_sigil_id_hour_path_country_idx` ON `sigil_views_hourly` (`sigil_id`,`hour`,`path`,`country`);--> statement-breakpoint
CREATE INDEX `sigil_views_hourly_sigil_id_hour_idx` ON `sigil_views_hourly` (`sigil_id`,`hour`);--> statement-breakpoint
CREATE UNIQUE INDEX `sigil_vitals_hourly_sigil_id_hour_metric_path_idx` ON `sigil_vitals_hourly` (`sigil_id`,`hour`,`metric`,`path`);--> statement-breakpoint
CREATE INDEX `sigil_vitals_hourly_sigil_id_hour_idx` ON `sigil_vitals_hourly` (`sigil_id`,`hour`);--> statement-breakpoint
CREATE UNIQUE INDEX `sigil_uniques_daily_sigil_id_day_visitor_hash_idx` ON `sigil_uniques_daily` (`sigil_id`,`day`,`visitor_hash`);--> statement-breakpoint
CREATE INDEX `sigil_uniques_daily_sigil_id_day_idx` ON `sigil_uniques_daily` (`sigil_id`,`day`);--> statement-breakpoint
CREATE UNIQUE INDEX `sigil_error_groups_sigil_id_fingerprint_idx` ON `sigil_error_groups` (`sigil_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `sigil_error_groups_sigil_id_last_seen_at_idx` ON `sigil_error_groups` (`sigil_id`,`last_seen_at`);
