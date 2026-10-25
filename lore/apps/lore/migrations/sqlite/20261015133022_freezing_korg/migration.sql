CREATE TABLE `monitor_heartbeats` (
	`id` text PRIMARY KEY,
	`monitor_id` text NOT NULL,
	`at` text NOT NULL,
	`ok` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`error` text,
	CONSTRAINT `fk_monitor_heartbeats_monitor_id_monitors_id_fk` FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `monitor_incidents` (
	`id` text PRIMARY KEY,
	`monitor_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`cause` text NOT NULL,
	`last_error` text,
	CONSTRAINT `fk_monitor_incidents_monitor_id_monitors_id_fk` FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `monitors` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`interval_secs` integer DEFAULT 60 NOT NULL,
	`timeout_secs` integer DEFAULT 10 NOT NULL,
	`confirmations` integer DEFAULT 2 NOT NULL,
	`expect` text DEFAULT '{}' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`status_since` text NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`last_checked_at` text,
	`next_check_at` text NOT NULL,
	`last_latency_ms` integer,
	`last_error` text,
	`cert_expires_at` text,
	CONSTRAINT `fk_monitors_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `monitor_heartbeats_monitor_id_at_idx` ON `monitor_heartbeats` (`monitor_id`,`at`);--> statement-breakpoint
CREATE INDEX `monitor_incidents_monitor_id_started_at_idx` ON `monitor_incidents` (`monitor_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `monitors_project_id_idx` ON `monitors` (`project_id`);--> statement-breakpoint
CREATE INDEX `monitors_active_next_check_at_idx` ON `monitors` (`active`,`next_check_at`);