CREATE TABLE `use_case_actors` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`use_case_id` integer NOT NULL,
	`persona_id` integer NOT NULL,
	`role` text DEFAULT 'primary' NOT NULL,
	CONSTRAINT `fk_use_case_actors_use_case_id_use_cases_id_fk` FOREIGN KEY (`use_case_id`) REFERENCES `use_cases`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_use_case_actors_persona_id_personas_id_fk` FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `use_case_alternatives` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`use_case_id` integer NOT NULL,
	`key` text NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	CONSTRAINT `fk_use_case_alternatives_use_case_id_use_cases_id_fk` FOREIGN KEY (`use_case_id`) REFERENCES `use_cases`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `use_case_criteria` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`use_case_id` integer NOT NULL,
	`key` text NOT NULL,
	`position` integer NOT NULL,
	`given_text` text,
	`when_text` text,
	`then_text` text,
	`text` text,
	`method` text DEFAULT 'manual' NOT NULL,
	`alternative_key` text,
	`requirement_id` integer,
	CONSTRAINT `fk_use_case_criteria_use_case_id_use_cases_id_fk` FOREIGN KEY (`use_case_id`) REFERENCES `use_cases`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `use_case_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`use_case_id` integer NOT NULL,
	`position` integer NOT NULL,
	`actor_persona_id` integer,
	`text` text NOT NULL,
	CONSTRAINT `fk_use_case_steps_use_case_id_use_cases_id_fk` FOREIGN KEY (`use_case_id`) REFERENCES `use_cases`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `use_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`project_id` integer NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`preconditions` text DEFAULT '' NOT NULL,
	`starting_data` text,
	`automated_test_path` text,
	`automated_test_tag` text,
	`scenario_version` integer DEFAULT 1 NOT NULL,
	`criterion_seq` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_use_cases_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `use_case_actors_use_case_id_persona_id_idx` ON `use_case_actors` (`use_case_id`,`persona_id`);--> statement-breakpoint
CREATE INDEX `use_case_alternatives_use_case_id_position_idx` ON `use_case_alternatives` (`use_case_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `use_case_criteria_use_case_id_key_idx` ON `use_case_criteria` (`use_case_id`,`key`);--> statement-breakpoint
CREATE INDEX `use_case_steps_use_case_id_position_idx` ON `use_case_steps` (`use_case_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `use_cases_project_id_number_idx` ON `use_cases` (`project_id`,`number`);