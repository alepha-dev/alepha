ALTER TABLE `oauth_clients` ADD `type` text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE `oauth_clients` ADD `client_secret_hash` text;