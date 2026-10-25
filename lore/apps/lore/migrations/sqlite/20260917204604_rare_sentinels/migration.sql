CREATE TABLE `organization_invitations` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text NOT NULL,
	`invited_by` text NOT NULL,
	`email` text NOT NULL,
	`status` text NOT NULL,
	`rank` text,
	`metadata` text,
	`expires_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	CONSTRAINT `fk_organization_invitations_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `organization_members` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`rank` text,
	CONSTRAINT `fk_organization_members_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_organization_members_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `organization_ranks` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`builtin` integer DEFAULT false NOT NULL,
	`permissions` text NOT NULL,
	CONSTRAINT `fk_organization_ranks_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`name` text NOT NULL,
	`slug` text,
	`logo` text,
	`metadata` text
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `organization_id` text REFERENCES organizations(id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX `organization_invitations_email_status_idx` ON `organization_invitations` (`email`,`status`);--> statement-breakpoint
CREATE INDEX `organization_invitations_organization_id_email_status_idx` ON `organization_invitations` (`organization_id`,`email`,`status`);--> statement-breakpoint
CREATE INDEX `organization_invitations_invited_by_idx` ON `organization_invitations` (`invited_by`);--> statement-breakpoint
CREATE INDEX `organization_invitations_expires_at_idx` ON `organization_invitations` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_members_organization_id_user_id_idx` ON `organization_members` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_ranks_organization_id_key_idx` ON `organization_ranks` (`organization_id`,`key`);--> statement-breakpoint
CREATE INDEX `organization_ranks_organization_id_idx` ON `organization_ranks` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_idx` ON `organizations` (`slug`);