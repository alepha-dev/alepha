-- #Q4222: a usage-limit pause no longer exists; a paused job ended failed.
UPDATE `host_jobs` SET `status` = 'failed' WHERE `status` = 'paused';--> statement-breakpoint
ALTER TABLE `host_jobs` DROP COLUMN `result`;--> statement-breakpoint
ALTER TABLE `host_jobs` DROP COLUMN `retries`;--> statement-breakpoint
ALTER TABLE `host_jobs` DROP COLUMN `retry_at`;--> statement-breakpoint
ALTER TABLE `hosts` DROP COLUMN `agent_cli_version`;--> statement-breakpoint
ALTER TABLE `hosts` DROP COLUMN `agent_model`;--> statement-breakpoint
ALTER TABLE `hosts` DROP COLUMN `agent_credential`;--> statement-breakpoint
ALTER TABLE `job_keys` DROP COLUMN `tools`;--> statement-breakpoint
ALTER TABLE `job_keys` DROP COLUMN `repository_id`;--> statement-breakpoint
ALTER TABLE `job_keys` DROP COLUMN `write_ref_prefix`;