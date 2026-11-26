ALTER TABLE `job_keys` ADD `error_id` integer;--> statement-breakpoint
CREATE INDEX `host_jobs_project_id_subject_type_subject_id_idx` ON `host_jobs` (`project_id`,`subject_type`,`subject_id`);