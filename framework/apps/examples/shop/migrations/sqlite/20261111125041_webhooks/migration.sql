CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`endpoint_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`response_status` integer,
	`response_excerpt` text,
	`duration_ms` integer,
	`delivered_at` integer,
	`error` text,
	CONSTRAINT `fk_webhook_deliveries_endpoint_id_webhook_endpoints_id_fk` FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoints`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`url` text NOT NULL,
	`description` text,
	`events` text DEFAULT '[]' NOT NULL,
	`secret` text NOT NULL,
	`previous_secret` text,
	`secret_prefix` text NOT NULL,
	`previous_secret_expires_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`disabled_reason` text,
	`scope` text,
	`created_by` text,
	`failing_since` integer,
	`last_delivery_at` integer,
	`last_success_at` integer
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_endpoint_id_created_at_idx` ON `webhook_deliveries` (`endpoint_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_event_type_created_at_idx` ON `webhook_deliveries` (`event_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_status_idx` ON `webhook_deliveries` (`status`);--> statement-breakpoint
CREATE INDEX `webhook_endpoints_status_idx` ON `webhook_endpoints` (`status`);--> statement-breakpoint
CREATE INDEX `webhook_endpoints_scope_idx` ON `webhook_endpoints` (`scope`);