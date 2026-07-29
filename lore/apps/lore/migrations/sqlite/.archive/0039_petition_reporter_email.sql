-- D1-safe migration: replace reporter_user_id (FK → users) with reporter_email (text, nullable).
--
-- WHY THIS IS HAND-WRITTEN (not auto-generated):
--   Cloudflare D1 ignores PRAGMA foreign_keys=OFF, so any table rebuild that
--   DROP TABLE `petitions` would fire quests.petition_id ON DELETE SET NULL,
--   silently NULLing every petition→quest link on production.
--   The auto-generated Drizzle migration is therefore a data-loss bomb on D1.
--
-- STRATEGY:
--   1. Back up quest→petition links before the rebuild.
--   2. Rebuild petitions without reporter_user_id, with reporter_email,
--      back-filling reporter_email from the referenced user row.
--   3. Restore the quest→petition links that D1's SET NULL action will have NULLed.
--   4. Drop scratch tables.
--
-- See CLAUDE.md "Migration safety on D1" and folio #12 (security note on
-- reporter_email being attacker-controlled on the anonymous-sigil path).

-- 1. Back up quest→petition links before the rebuild.
--    D1 fires quests' SET NULL action on DROP TABLE `petitions` so we
--    snapshot the links now while they are still intact.
CREATE TABLE `__bk_quest_petition` AS
  SELECT `id` AS `quest_id`, `petition_id` FROM `quests` WHERE `petition_id` IS NOT NULL;
--> statement-breakpoint

-- 2a. Create the rebuilt petitions table (no reporter_user_id, with reporter_email).
CREATE TABLE `__new_petitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`short_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`campaign_id` integer NOT NULL,
	`reporter_email` text,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`source` text,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

-- 2b. Copy all existing petition rows, back-filling reporter_email from users.
INSERT INTO `__new_petitions` (
	`id`,
	`short_id`,
	`created_at`,
	`deleted_at`,
	`campaign_id`,
	`reporter_email`,
	`title`,
	`description`,
	`status`,
	`attachments`,
	`tags`,
	`source`
)
SELECT
	`id`,
	`short_id`,
	`created_at`,
	`deleted_at`,
	`campaign_id`,
	(SELECT `email` FROM `users` WHERE `users`.`id` = `petitions`.`reporter_user_id`),
	`title`,
	`description`,
	`status`,
	`attachments`,
	`tags`,
	`source`
FROM `petitions`;
--> statement-breakpoint

-- 2c. Drop the old table (fires SET NULL on quests.petition_id on D1 — restored in step 3).
DROP TABLE `petitions`;
--> statement-breakpoint

-- 2d. Promote the rebuilt table.
ALTER TABLE `__new_petitions` RENAME TO `petitions`;
--> statement-breakpoint

-- 2e. Recreate all indexes that existed on petitions (old reporter_user_id index
--     replaced by reporter_email index per the updated entity definition).
CREATE INDEX `petitions_campaign_id_status_deleted_at_idx` ON `petitions` (`campaign_id`,`status`,`deleted_at`);
--> statement-breakpoint
CREATE INDEX `petitions_campaign_id_created_at_idx` ON `petitions` (`campaign_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `petitions_campaign_id_short_id_idx` ON `petitions` (`campaign_id`,`short_id`);
--> statement-breakpoint
CREATE INDEX `petitions_reporter_email_created_at_idx` ON `petitions` (`reporter_email`,`created_at`);
--> statement-breakpoint

-- 3. Restore quest→petition links NULLed by the DROP TABLE above.
UPDATE `quests`
  SET `petition_id` = (
    SELECT `petition_id`
    FROM `__bk_quest_petition`
    WHERE `__bk_quest_petition`.`quest_id` = `quests`.`id`
  )
  WHERE `id` IN (SELECT `quest_id` FROM `__bk_quest_petition`);
--> statement-breakpoint

-- 4. Clean up scratch tables.
DROP TABLE `__bk_quest_petition`;
