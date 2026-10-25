CREATE TABLE `automation_events` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`project_id` integer NOT NULL,
	`identity` text NOT NULL,
	`name` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`replay_until` integer NOT NULL,
	`payload` text NOT NULL,
	`cursor` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`dispatched_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_automation_events_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `automation_receipts` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`project_id` integer NOT NULL,
	`automation_id` text,
	`identity` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`occurrence_id` text NOT NULL,
	`rule_revision` integer NOT NULL,
	`occurred_at` integer NOT NULL,
	`replay_until` integer NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`parent_id` text,
	`run_id` text,
	`input_hash` text,
	`mode` text,
	`snapshot` text,
	`result` text,
	`recipient_user_id` text,
	`recipient_channel` text,
	`position` integer,
	`action_index` integer,
	`row_index` integer,
	`delivery_key` text,
	`cursor` integer DEFAULT 0 NOT NULL,
	`queue_attempts` integer DEFAULT 0 NOT NULL,
	`roster_complete` integer DEFAULT false NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_automation_receipts_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_automation_receipts_automation_id_automations_id_fk` FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "automation_receipts_valid_id" CHECK(id IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_events_project_id_identity_idx` ON `automation_events` (`project_id`,`identity`);--> statement-breakpoint
CREATE INDEX `automation_events_dispatched_at_attempts_created_at_id_idx` ON `automation_events` (`dispatched_at`,`attempts`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `automation_events_replay_until_id_idx` ON `automation_events` (`replay_until`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `automation_receipts_project_id_identity_idx` ON `automation_receipts` (`project_id`,`identity`);--> statement-breakpoint
CREATE UNIQUE INDEX `automation_receipts_running_rule` ON `automation_receipts` (`automation_id`) WHERE kind = 'occurrence' AND status = 'claimed';--> statement-breakpoint
CREATE INDEX `automation_receipts_kind_status_lease_until_id_idx` ON `automation_receipts` (`kind`,`status`,`lease_until`,`id`);--> statement-breakpoint
CREATE INDEX `automation_receipts_parent_id_kind_position_idx` ON `automation_receipts` (`parent_id`,`kind`,`position`);--> statement-breakpoint
CREATE INDEX `automation_receipts_kind_status_queue_attempts_created_at_id_idx` ON `automation_receipts` (`kind`,`status`,`queue_attempts`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `automation_receipts_project_id_kind_created_at_id_idx` ON `automation_receipts` (`project_id`,`kind`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `automation_receipts_replay_until_status_id_idx` ON `automation_receipts` (`replay_until`,`status`,`id`);