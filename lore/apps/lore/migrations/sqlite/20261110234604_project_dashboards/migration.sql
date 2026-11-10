-- A project holds several named dashboards (#E127, #Q3298).
--
-- `project_dashboards` is new, and every card gains a nullable `dashboard_id`
-- as a plain `ADD COLUMN ... REFERENCES`: no rebuild of
-- `project_dashboard_cards`, whose rebuild on D1 is the cascade-wipe shape
-- (apps/lore/AGENTS.md, "Migration safety on D1").
--
-- The backfill below gives each project that has stored cards one dashboard,
-- position 0, with no name and no slug (the screen shows the localized
-- "Dashboard" label), and moves its cards onto it. A project with no stored
-- card gets no row: rows are lazy, and such a project keeps one implicit
-- first dashboard, the computed board. `created_at` takes its column default,
-- epoch milliseconds.
--
-- A card left with no `dashboard_id` (one the previous Worker writes in the
-- deploy window) reads as its project's first dashboard's, and is adopted by
-- the next write that resolves that dashboard.

CREATE TABLE `project_dashboards` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`name` text,
	`slug` text,
	`position` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_project_dashboards_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `project_dashboard_cards` ADD `dashboard_id` integer REFERENCES project_dashboards(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `project_dashboard_cards_dashboard_id_position_idx` ON `project_dashboard_cards` (`dashboard_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_dashboards_project_id_slug_idx` ON `project_dashboards` (`project_id`,`slug`);--> statement-breakpoint
CREATE INDEX `project_dashboards_project_id_position_idx` ON `project_dashboards` (`project_id`,`position`);--> statement-breakpoint
INSERT INTO `project_dashboards` (`project_id`, `position`)
SELECT DISTINCT `project_id`, 0 FROM `project_dashboard_cards`;--> statement-breakpoint
UPDATE `project_dashboard_cards`
SET `dashboard_id` = (
  SELECT `d`.`id` FROM `project_dashboards` AS `d`
  WHERE `d`.`project_id` = `project_dashboard_cards`.`project_id`
)
WHERE `dashboard_id` IS NULL;
