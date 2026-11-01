ALTER TABLE `analytics_mcp_calls_raw` ADD `project` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_mcp_calls_rolled` ADD `project` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `analytics_mcp_calls_raw_time_bucket_actor_outcome_tool_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `analytics_mcp_calls_rolled_time_bucket_actor_outcome_tool_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_mcp_calls_raw_time_bucket_actor_outcome_project_tool_idx` ON `analytics_mcp_calls_raw` (`time_bucket`,`actor`,`outcome`,`project`,`tool`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_mcp_calls_rolled_time_bucket_actor_outcome_project_tool_idx` ON `analytics_mcp_calls_rolled` (`time_bucket`,`actor`,`outcome`,`project`,`tool`);