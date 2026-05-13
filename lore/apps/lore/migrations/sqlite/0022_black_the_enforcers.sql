-- alepha_sequences: shared counter table for the $sequence primitive.
CREATE TABLE `alepha_sequences` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`name` text NOT NULL,
	`scope` text DEFAULT 'default' NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alepha_sequences_name_scope_idx` ON `alepha_sequences` (`name`,`scope`);
--> statement-breakpoint

-- Add `short_id` to folios with a temporary 0 default, then backfill with a
-- per-campaign ROW_NUMBER ordered by createdAt (insertion order), then add the
-- unique (campaign_id, short_id) index.
ALTER TABLE `folios` ADD `short_id` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `folios` SET `short_id` = (
	SELECT row_num FROM (
		SELECT id AS row_id, ROW_NUMBER() OVER (PARTITION BY campaign_id ORDER BY created_at, id) AS row_num
		FROM `folios`
	) ranked
	WHERE ranked.row_id = `folios`.id
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folios_campaign_id_short_id_idx` ON `folios` (`campaign_id`,`short_id`);
--> statement-breakpoint

-- Same dance for petitions.
ALTER TABLE `petitions` ADD `short_id` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `petitions` SET `short_id` = (
	SELECT row_num FROM (
		SELECT id AS row_id, ROW_NUMBER() OVER (PARTITION BY campaign_id ORDER BY created_at, id) AS row_num
		FROM `petitions`
	) ranked
	WHERE ranked.row_id = `petitions`.id
);
--> statement-breakpoint
CREATE UNIQUE INDEX `petitions_campaign_id_short_id_idx` ON `petitions` (`campaign_id`,`short_id`);
--> statement-breakpoint

-- Same for quests.
ALTER TABLE `quests` ADD `short_id` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `quests` SET `short_id` = (
	SELECT row_num FROM (
		SELECT id AS row_id, ROW_NUMBER() OVER (PARTITION BY campaign_id ORDER BY created_at, id) AS row_num
		FROM `quests`
	) ranked
	WHERE ranked.row_id = `quests`.id
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quests_campaign_id_short_id_idx` ON `quests` (`campaign_id`,`short_id`);
--> statement-breakpoint

-- Seed alepha_sequences from the backfilled values so the next call to
-- $sequence.next(campaignId) starts above the highest existing short_id (or
-- number, for chapters). Names match the controller property keys.
INSERT INTO `alepha_sequences` (id, name, scope, value)
SELECT lower(hex(randomblob(16))), 'questShortId', CAST(campaign_id AS TEXT), MAX(short_id)
FROM `quests`
GROUP BY campaign_id;
--> statement-breakpoint
INSERT INTO `alepha_sequences` (id, name, scope, value)
SELECT lower(hex(randomblob(16))), 'folioShortId', CAST(campaign_id AS TEXT), MAX(short_id)
FROM `folios`
GROUP BY campaign_id;
--> statement-breakpoint
INSERT INTO `alepha_sequences` (id, name, scope, value)
SELECT lower(hex(randomblob(16))), 'petitionShortId', CAST(campaign_id AS TEXT), MAX(short_id)
FROM `petitions`
GROUP BY campaign_id;
--> statement-breakpoint
INSERT INTO `alepha_sequences` (id, name, scope, value)
SELECT lower(hex(randomblob(16))), 'chapterNumber', CAST(campaign_id AS TEXT), MAX(number)
FROM `chapters`
GROUP BY campaign_id;
