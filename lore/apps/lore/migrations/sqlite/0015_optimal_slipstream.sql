CREATE TABLE `folio_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`folio_id` text NOT NULL,
	`at` integer NOT NULL,
	`by_user_id` text,
	`action` text NOT NULL,
	`content_snapshot` text NOT NULL,
	`title_snapshot` text NOT NULL,
	`tags_snapshot` text DEFAULT '[]' NOT NULL,
	`summary_snapshot` text DEFAULT '' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`folio_id`) REFERENCES `folios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `folio_revisions_folio_id_at_idx` ON `folio_revisions` (`folio_id`,`at`);