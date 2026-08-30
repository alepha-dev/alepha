-- Release planning fields (epic #14 "Lore Release").
--
-- Every new column is nullable with NO `db.default`, so each is a plain
-- additive ADD COLUMN. `tag` is nullable at the column and required in the
-- create schema on purpose: declaring it NOT NULL would force a column
-- DEFAULT, since SQLite's `ADD COLUMN NOT NULL` demands one, and the rule
-- here is that constraints live on the way in.
--
-- `released_at` is a NEW column, not `closed_at` renamed. They mean different
-- things: `closed_at` ended a time window, `released_at` is the one-way
-- publish stamp. drizzle was told `create` explicitly so it would not guess a
-- rename and silently carry the old semantics across.
--
-- The three DROP COLUMNs are the real judgement call, and they are safe HERE
-- specifically: the table has zero rows (the previous migration wiped it),
-- exactly one inbound FK which is ON DELETE SET NULL, and none of the three
-- carries an index or an FK - so SQLite takes all three natively rather than
-- rebuilding. Precedent: `ALTER TABLE quests DROP COLUMN difficulty`
-- (2026-08-20). Dropping `tags` is the one that matters: `release.tag` beside
-- `release.tags` is a one-character trap nobody survives.
--
-- Read before pushing: zero DROP TABLE, zero rebuild.

ALTER TABLE `releases` ADD `tag` text;--> statement-breakpoint
ALTER TABLE `releases` ADD `target_date` integer;--> statement-breakpoint
ALTER TABLE `releases` ADD `released_at` integer;--> statement-breakpoint
ALTER TABLE `releases` ADD `completed` integer;--> statement-breakpoint
ALTER TABLE `releases` ADD `in_progress` integer;--> statement-breakpoint
ALTER TABLE `releases` ADD `shelved` integer;--> statement-breakpoint
ALTER TABLE `releases` ADD `total` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `releases_project_id_tag_idx` ON `releases` (`project_id`,`tag`);--> statement-breakpoint
ALTER TABLE `releases` DROP COLUMN `closes_at`;--> statement-breakpoint
ALTER TABLE `releases` DROP COLUMN `closed_at`;--> statement-breakpoint
ALTER TABLE `releases` DROP COLUMN `tags`;
