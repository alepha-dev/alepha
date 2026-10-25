-- Vitals histogram: one JSON blob -> seven integer columns.
--
-- Additive first, then a backfill, then the drop. drizzle-kit generated the
-- ADDs and the DROP and NOTHING in between: it would have thrown away every
-- histogram in production. Read generated migrations for what they omit, not
-- only for `DROP TABLE` (see apps/lore/CLAUDE.md).
--
-- No table rebuild here, so the `sigils` CASCADE bomb does not apply; and each
-- ADD carries a DEFAULT, which is what SQLite requires to add a NOT NULL column
-- to a populated table.
ALTER TABLE `sigil_vitals_hourly` ADD `b0` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sigil_vitals_hourly` ADD `b1` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sigil_vitals_hourly` ADD `b2` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sigil_vitals_hourly` ADD `b3` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sigil_vitals_hourly` ADD `b4` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sigil_vitals_hourly` ADD `b5` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sigil_vitals_hourly` ADD `b6` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Keys are quoted (`$."0"`, not `$.0`) so JSON1 reads them as object members
-- rather than array indexes. A row with no entry for a bucket keeps its 0.
UPDATE `sigil_vitals_hourly` SET
  `b0` = COALESCE(CAST(json_extract(`bucket_counts`, '$."0"') AS integer), 0),
  `b1` = COALESCE(CAST(json_extract(`bucket_counts`, '$."1"') AS integer), 0),
  `b2` = COALESCE(CAST(json_extract(`bucket_counts`, '$."2"') AS integer), 0),
  `b3` = COALESCE(CAST(json_extract(`bucket_counts`, '$."3"') AS integer), 0),
  `b4` = COALESCE(CAST(json_extract(`bucket_counts`, '$."4"') AS integer), 0),
  `b5` = COALESCE(CAST(json_extract(`bucket_counts`, '$."5"') AS integer), 0),
  `b6` = COALESCE(CAST(json_extract(`bucket_counts`, '$."6"') AS integer), 0)
WHERE `bucket_counts` IS NOT NULL AND json_valid(`bucket_counts`);--> statement-breakpoint
ALTER TABLE `sigil_vitals_hourly` DROP COLUMN `bucket_counts`;
