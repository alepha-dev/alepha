PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`invited_by` text NOT NULL,
	`email` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`status` text NOT NULL,
	`roles` text,
	`metadata` text,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_invitations`("id", "version", "created_at", "updated_at", "invited_by", "email", "resource_type", "resource_id", "status", "roles", "metadata", "token", "expires_at", "resolved_at", "resolved_by") SELECT "id", "version", "created_at", "updated_at", "invited_by", "email", "resource_type", "resource_id", "status", "roles", "metadata", "token", "expires_at", "resolved_at", "resolved_by" FROM `invitations`;--> statement-breakpoint
DROP TABLE `invitations`;--> statement-breakpoint
ALTER TABLE `__new_invitations` RENAME TO `invitations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `invitations_email_status_idx` ON `invitations` (`email`,`status`);--> statement-breakpoint
CREATE INDEX `invitations_resource_type_resource_id_email_status_idx` ON `invitations` (`resource_type`,`resource_id`,`email`,`status`);--> statement-breakpoint
CREATE INDEX `invitations_invited_by_idx` ON `invitations` (`invited_by`);--> statement-breakpoint
CREATE INDEX `invitations_expires_at_idx` ON `invitations` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_idx` ON `invitations` (`token`);