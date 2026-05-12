PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `projects` RENAME TO `campaigns`;--> statement-breakpoint
ALTER TABLE `tasks` RENAME TO `quests`;--> statement-breakpoint
ALTER TABLE `campaigns` RENAME COLUMN `packages` TO `zones`;--> statement-breakpoint
ALTER TABLE `quests` RENAME COLUMN `project_id` TO `campaign_id`;--> statement-breakpoint
ALTER TABLE `quests` RENAME COLUMN `package` TO `zone`;--> statement-breakpoint
ALTER TABLE `quests` RENAME COLUMN `complexity` TO `difficulty`;--> statement-breakpoint
ALTER TABLE `chapters` RENAME COLUMN `project_id` TO `campaign_id`;--> statement-breakpoint
ALTER TABLE `characters` RENAME COLUMN `project_id` TO `campaign_id`;--> statement-breakpoint
ALTER TABLE `whiteboards` RENAME COLUMN `project_id` TO `campaign_id`;--> statement-breakpoint
DROP INDEX `tasks_project_id_deleted_at_idx`;--> statement-breakpoint
DROP INDEX `tasks_accepted_by_idx`;--> statement-breakpoint
DROP INDEX `tasks_completed_by_idx`;--> statement-breakpoint
DROP INDEX `tasks_chapter_id_idx`;--> statement-breakpoint
DROP INDEX `characters_user_id_project_id_idx`;--> statement-breakpoint
DROP INDEX `projects_created_by_idx`;--> statement-breakpoint
DROP INDEX `chapters_project_id_idx`;--> statement-breakpoint
DROP INDEX `chapters_project_id_number_idx`;--> statement-breakpoint
DROP INDEX `whiteboards_project_id_idx`;--> statement-breakpoint
CREATE INDEX `quests_campaign_id_deleted_at_idx` ON `quests` (`campaign_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `quests_accepted_by_idx` ON `quests` (`accepted_by`);--> statement-breakpoint
CREATE INDEX `quests_completed_by_idx` ON `quests` (`completed_by`);--> statement-breakpoint
CREATE INDEX `quests_chapter_id_idx` ON `quests` (`chapter_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `characters_user_id_campaign_id_idx` ON `characters` (`user_id`,`campaign_id`);--> statement-breakpoint
CREATE INDEX `campaigns_created_by_idx` ON `campaigns` (`created_by`);--> statement-breakpoint
CREATE INDEX `chapters_campaign_id_idx` ON `chapters` (`campaign_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chapters_campaign_id_number_idx` ON `chapters` (`campaign_id`,`number`);--> statement-breakpoint
CREATE INDEX `whiteboards_campaign_id_idx` ON `whiteboards` (`campaign_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
