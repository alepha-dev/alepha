CREATE TABLE `analytics_mcp_calls_raw` (
	`time_bucket` text NOT NULL,
	`tool` text NOT NULL,
	`outcome` text DEFAULT 'ok' NOT NULL,
	`actor` text DEFAULT 'anon' NOT NULL,
	`count` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_mcp_calls_rolled` (
	`time_bucket` text NOT NULL,
	`tool` text NOT NULL,
	`outcome` text DEFAULT 'ok' NOT NULL,
	`actor` text DEFAULT 'anon' NOT NULL,
	`count` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_mcp_calls_raw_time_bucket_actor_outcome_tool_idx` ON `analytics_mcp_calls_raw` (`time_bucket`,`actor`,`outcome`,`tool`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_mcp_calls_rolled_time_bucket_actor_outcome_tool_idx` ON `analytics_mcp_calls_rolled` (`time_bucket`,`actor`,`outcome`,`tool`);