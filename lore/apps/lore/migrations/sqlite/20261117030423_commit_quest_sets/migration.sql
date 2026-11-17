CREATE TABLE `commit_quest_sets` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`commit_sha` text NOT NULL,
	`quests` text NOT NULL,
	`complete` integer NOT NULL,
	CONSTRAINT `fk_commit_quest_sets_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `artifacts` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `deployments` ADD `commit_sha` text;--> statement-breakpoint
ALTER TABLE `deployments` ADD `dirty` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `commit_quest_sets_project_id_commit_sha_idx` ON `commit_quest_sets` (`project_id`,`commit_sha`);