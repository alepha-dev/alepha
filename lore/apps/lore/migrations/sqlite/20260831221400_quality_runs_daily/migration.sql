ALTER TABLE `quality_runs` ADD `updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL;--> statement-breakpoint
-- ⚠️ `DEFAULT ''` is not in the entity, and is here on purpose. SQLite accepts
-- `ADD COLUMN ... NOT NULL` with no default ONLY while the table is empty, and
-- `quality_runs` is empty in production only because every push so far was
-- refused by the body limit. A default makes the statement legal whatever the
-- table holds; no row can actually receive it, since `day` is required by the
-- schema and stamped server-side on every write.
ALTER TABLE `quality_runs` ADD `day` text DEFAULT '' NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `quality_runs_project_id_created_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `quality_runs_project_id_branch_created_at_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `quality_runs_project_id_branch_day_idx` ON `quality_runs` (`project_id`,`branch`,`day`);--> statement-breakpoint
CREATE INDEX `quality_runs_project_id_day_idx` ON `quality_runs` (`project_id`,`day`);--> statement-breakpoint
ALTER TABLE `quality_runs` DROP COLUMN `file_id`;