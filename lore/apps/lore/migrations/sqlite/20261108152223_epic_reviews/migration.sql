CREATE TABLE `epic_review_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`review_id` integer NOT NULL,
	`epic_id` integer NOT NULL,
	`number` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`suggestions` text DEFAULT '[]' NOT NULL,
	`recommended` integer,
	`state` text,
	`answer` text,
	`answer_suggestion` integer,
	`answered_by` text,
	`answered_at` integer,
	`replaces` integer,
	`replaced_by` integer,
	`created_by` text,
	`target` text,
	CONSTRAINT `fk_epic_review_items_review_id_epic_reviews_id_fk` FOREIGN KEY (`review_id`) REFERENCES `epic_reviews`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_epic_review_items_epic_id_epics_id_fk` FOREIGN KEY (`epic_id`) REFERENCES `epics`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_epic_review_items_answered_by_users_id_fk` FOREIGN KEY (`answered_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_epic_review_items_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `epic_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`epic_id` integer NOT NULL,
	`created_by` text,
	`summary` text DEFAULT '' NOT NULL,
	CONSTRAINT `fk_epic_reviews_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_epic_reviews_epic_id_epics_id_fk` FOREIGN KEY (`epic_id`) REFERENCES `epics`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_epic_reviews_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `epic_review_items_epic_id_number_idx` ON `epic_review_items` (`epic_id`,`number`);--> statement-breakpoint
CREATE INDEX `epic_review_items_review_id_idx` ON `epic_review_items` (`review_id`);--> statement-breakpoint
CREATE INDEX `epic_reviews_epic_id_created_at_idx` ON `epic_reviews` (`epic_id`,`created_at`);