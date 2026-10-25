ALTER TABLE `epics` ADD `depends_on` integer REFERENCES epics(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `roadmap_visibility` text;