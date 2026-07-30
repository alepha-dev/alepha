CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`client_id` text NOT NULL,
	`client_name` text NOT NULL,
	`redirect_uris` text DEFAULT '[]' NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`realm` text NOT NULL,
	`type` text DEFAULT 'public' NOT NULL,
	`trusted` integer DEFAULT false NOT NULL,
	`client_secret_hash` text,
	`source` text DEFAULT 'dcr' NOT NULL,
	`created_by_user_id` text,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_clients_client_id_idx` ON `oauth_clients` (`client_id`);