ALTER TABLE `host_jobs` ADD `steps` text;--> statement-breakpoint
ALTER TABLE `quests` ADD `worked_by_job_id` text;--> statement-breakpoint
CREATE INDEX `quests_project_id_worked_by_job_id_idx` ON `quests` (`project_id`,`worked_by_job_id`);