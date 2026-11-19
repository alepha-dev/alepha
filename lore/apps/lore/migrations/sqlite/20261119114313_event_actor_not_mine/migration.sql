ALTER TABLE `event_subscriptions` ADD `not_mine` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `project_events` ADD `actor_id` text;