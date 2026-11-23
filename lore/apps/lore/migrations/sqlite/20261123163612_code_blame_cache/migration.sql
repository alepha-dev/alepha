CREATE TABLE `code_blame_cache` (
	`id` text PRIMARY KEY,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`repository_id` text NOT NULL,
	`commit_sha` text NOT NULL,
	`path` text NOT NULL,
	`status` text NOT NULL,
	`ranges` text NOT NULL,
	`stopped_at_sha` text,
	`steps` integer NOT NULL,
	`state` text,
	CONSTRAINT `fk_code_blame_cache_repository_id_code_repositories_id_fk` FOREIGN KEY (`repository_id`) REFERENCES `code_repositories`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX `code_blame_cache_repository_id_commit_sha_path_idx` ON `code_blame_cache` (`repository_id`,`commit_sha`,`path`);