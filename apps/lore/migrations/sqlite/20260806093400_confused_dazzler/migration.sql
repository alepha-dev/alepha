-- Reshape a sigil from `app` + `environment` + `label` into a single `name`.
--
-- A sigil used to be "one environment of one application", unique on
-- (project_id, app, environment). It is now simply a named app, unique on
-- (project_id, name). An operator who still wants staging and production kept
-- apart creates two sigils and names them so.
--
-- HAND-EDITED. drizzle-kit's output for this change was, verbatim:
--
--   ALTER TABLE `sigils` ADD `name` text NOT NULL;
--   DROP INDEX IF EXISTS `sigils_project_id_app_environment_idx`;
--   CREATE UNIQUE INDEX `sigils_project_id_name_idx` ON `sigils` (`project_id`,`name`);
--   ALTER TABLE `sigils` DROP COLUMN `app`;
--   ALTER TABLE `sigils` DROP COLUMN `environment`;
--   ALTER TABLE `sigils` DROP COLUMN `label`;
--
-- Two things are wrong with it and one thing is right.
--
-- Right, and the reason this file is short: it is NOT a table rebuild. There is
-- no `__new_sigils`, no `INSERT ... SELECT`, no `DROP TABLE sigils`, no RENAME.
-- That matters more here than anywhere else in this schema — four tables
-- reference `sigils.id` ON DELETE CASCADE (`sigil_views_hourly`,
-- `sigil_uniques_daily`, `sigil_vitals_hourly`, `sigil_error_groups`), and D1
-- ignores `PRAGMA foreign_keys=OFF`, so a rebuild's `DROP TABLE sigils` is a
-- silent cascade DELETE of every aggregate row (493 of them in production at the
-- time of writing). That is the exact pattern that destroyed lore-production in
-- 2026-05. See apps/lore/CLAUDE.md → "Migration safety on D1". If a future
-- change to this table ever generates a rebuild, hand-write it like this one.
--
-- Wrong #1 — `ADD ... text NOT NULL` cannot be executed. SQLite refuses to add a
-- NOT NULL column with no default to a table that has rows ("Cannot add a NOT
-- NULL column with default value NULL"). It succeeds on an empty database, which
-- is every database CI ever sees, and fails on the only one that matters. The
-- column is therefore added nullable.
--
-- Wrong #2 — no backfill. drizzle drops `label` without carrying it anywhere, so
-- every existing sigil would come out of this migration nameless, then be handed
-- to a UNIQUE index. The `UPDATE`s below carry `label` into `name` first.
--
-- Order is load-bearing: ADD, then backfill, then de-duplicate, then swap the
-- indexes, and only then DROP. SQLite refuses to drop a column an index still
-- references, and no row is ever without a name in between.
--
-- The de-duplication runs BEFORE the unique index is created. `label` was only
-- unique by accident (the old unique index covered app+environment, not label),
-- so two sigils in one project could share one. Production has a single sigil,
-- so it is a no-op there — it exists so the migration cannot fail on a database
-- that is not production's.
--
-- `substr(..., 1, 100)` is not cosmetic: `label` was `max(200)` and `name` is
-- `max(100)`. Alepha validates rows on READ, so a 150-character name does not
-- degrade — it throws `SchemaValidationError` on every query that touches the
-- row, which is how the 2026-08-05 outage worked. Production's one label is
-- `lore / production` (17 chars), so nothing is actually truncated here.
--
-- Known, accepted drift: the snapshot describes `name` as NOT NULL and the
-- physical D1 column is nullable, because SQLite offers no way to add a NOT NULL
-- column to a populated table without also inventing a DEFAULT the snapshot does
-- not have. Backfilling from `label` — itself NOT NULL — is what makes the
-- constraint true in the data. Do not "fix" this by regenerating a rebuild.
ALTER TABLE `sigils` ADD `name` text;--> statement-breakpoint
UPDATE `sigils` SET `name` = substr(`label`, 1, 100);--> statement-breakpoint
UPDATE `sigils` SET `name` = substr(`name`, 1, 80) || ' (' || `rowid` || ')'
  WHERE `rowid` NOT IN (SELECT MIN(`rowid`) FROM `sigils` GROUP BY `project_id`, `name`);--> statement-breakpoint
DROP INDEX IF EXISTS `sigils_project_id_app_environment_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `sigils_project_id_name_idx` ON `sigils` (`project_id`,`name`);--> statement-breakpoint
ALTER TABLE `sigils` DROP COLUMN `app`;--> statement-breakpoint
ALTER TABLE `sigils` DROP COLUMN `environment`;--> statement-breakpoint
ALTER TABLE `sigils` DROP COLUMN `label`;
