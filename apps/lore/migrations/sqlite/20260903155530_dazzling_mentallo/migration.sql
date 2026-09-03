CREATE INDEX `epics_project_id_updated_at_idx` ON `epics` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `folio_revisions_at_idx` ON `folio_revisions` (`at`);--> statement-breakpoint
CREATE INDEX `quest_comments_created_at_idx` ON `quest_comments` (`created_at`);--> statement-breakpoint
CREATE INDEX `quests_project_id_updated_at_idx` ON `quests` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `releases_project_id_updated_at_idx` ON `releases` (`project_id`,`updated_at`);