CREATE TABLE `alepha_sequences` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`name` text NOT NULL,
	`scope` text DEFAULT 'default' NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`token_suffix` text NOT NULL,
	`roles` text DEFAULT '[]' NOT NULL,
	`last_used_at` integer,
	`last_used_ip` text,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE TABLE `archive_blobs` (
	`file_id` text PRIMARY KEY,
	`short_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`campaign_id` integer NOT NULL,
	`directory_id` text,
	`name` text NOT NULL,
	CONSTRAINT `fk_archive_blobs_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_archive_blobs_directory_id_archive_directories_id_fk` FOREIGN KEY (`directory_id`) REFERENCES `archive_directories`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `archive_directories` (
	`id` text PRIMARY KEY,
	`short_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`campaign_id` integer NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	CONSTRAINT `fk_archive_directories_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_archive_directories_parent_id_archive_directories_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `archive_directories`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `archive_names` (
	`id` text PRIMARY KEY,
	`parent_directory_id` text,
	`root_scope` text,
	`lower_name` text NOT NULL,
	`kind` text NOT NULL,
	`entity_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`type` text NOT NULL,
	`action` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`user_id` text,
	`user_realm` text,
	`user_email` text,
	`resource_type` text,
	`resource_id` text,
	`description` text,
	`metadata` text,
	`ip_address` text,
	`user_agent` text,
	`session_id` text,
	`request_id` text,
	`success` integer DEFAULT true NOT NULL,
	`error_message` text
);
--> statement-breakpoint
CREATE TABLE `blight_ignore_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`campaign_id` integer NOT NULL,
	`pattern` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_blight_ignore_rules_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_blight_ignore_rules_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `cache_entries` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`container` text NOT NULL,
	`cache_key` text NOT NULL,
	`value` text,
	`count` integer,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`title` text NOT NULL,
	`created_by` text NOT NULL,
	`public` integer,
	`icon` text,
	`zones` text DEFAULT '[]' NOT NULL,
	`features` text DEFAULT '{"kanban":true,"folios":true,"petitions":true,"chapters":true}' NOT NULL,
	`chapter_duration` text,
	`preferred_language` text,
	`retention_days` integer,
	`kanban_columns` text DEFAULT '["In Progress"]' NOT NULL,
	`unlocked_features` text DEFAULT '[]' NOT NULL,
	`unlock_history` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`campaign_id` integer NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`closes_at` integer,
	`closed_at` integer,
	`tags` text DEFAULT '[]' NOT NULL,
	`changelog` text,
	CONSTRAINT `fk_chapters_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `characters` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`campaign_id` integer NOT NULL,
	`xp` integer NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`owner` integer DEFAULT true NOT NULL,
	`alias` text,
	`picture` text,
	`equipped_title` text,
	`achievements` text DEFAULT '[]' NOT NULL,
	CONSTRAINT `fk_characters_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_characters_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`blob_id` text NOT NULL,
	`creator` text,
	`creator_realm` text,
	`creator_name` text,
	`bucket` text NOT NULL,
	`expiration_date` integer,
	`name` text NOT NULL,
	`original_name` text,
	`size` real NOT NULL,
	`mime_type` text NOT NULL,
	`tags` text,
	`checksum` text
);
--> statement-breakpoint
CREATE TABLE `folio_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`target_type` text DEFAULT 'folio' NOT NULL,
	CONSTRAINT `fk_folio_links_from_id_folios_id_fk` FOREIGN KEY (`from_id`) REFERENCES `folios`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `folio_revisions` (
	`id` text PRIMARY KEY,
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
	CONSTRAINT `fk_folio_revisions_folio_id_folios_id_fk` FOREIGN KEY (`folio_id`) REFERENCES `folios`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_folio_revisions_by_user_id_users_id_fk` FOREIGN KEY (`by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `folios` (
	`id` text PRIMARY KEY,
	`short_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`campaign_id` integer NOT NULL,
	`title` text NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`directory_id` text,
	`summary` text DEFAULT '' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	CONSTRAINT `fk_folios_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_folios_directory_id_archive_directories_id_fk` FOREIGN KEY (`directory_id`) REFERENCES `archive_directories`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `identities` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`password` text,
	`provider` text NOT NULL,
	`provider_user_id` text,
	`provider_data` text,
	CONSTRAINT `fk_identities_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`invited_by` text NOT NULL,
	`email` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`status` text NOT NULL,
	`roles` text,
	`metadata` text,
	`expires_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	CONSTRAINT `fk_invitations_invited_by_users_id_fk` FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `job_executions` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`job_name` text NOT NULL,
	`key` text,
	`organization_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 2 NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 1 NOT NULL,
	`payload` text,
	`scheduled_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`error` text,
	`logs` text,
	`triggered_by` text,
	`triggered_by_name` text,
	`cancelled_by` text,
	`cancelled_by_name` text
);
--> statement-breakpoint
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
CREATE TABLE `parameters` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`schema_hash` text NOT NULL,
	`activation_date` integer NOT NULL,
	`version` integer NOT NULL,
	`change_description` text,
	`tags` text,
	`creator_id` text,
	`creator_name` text,
	`previous_content` text,
	`migration_log` text
);
--> statement-breakpoint
CREATE TABLE `petitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`short_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`campaign_id` integer NOT NULL,
	`reporter_user_id` text,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`source` text,
	CONSTRAINT `fk_petitions_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_petitions_reporter_user_id_users_id_fk` FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `quests` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`short_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`zone` text NOT NULL,
	`priority` text NOT NULL,
	`difficulty` integer NOT NULL,
	`estimate_minutes` integer,
	`accepted_at` integer,
	`completed_at` integer,
	`shelved_at` integer,
	`shelved_by` text,
	`completion_message` text,
	`completion_message_updated_at` integer,
	`kanban_column` text,
	`objectives` text DEFAULT '[]' NOT NULL,
	`campaign_id` integer NOT NULL,
	`chapter_id` integer,
	`petition_id` integer,
	`created_by` text NOT NULL,
	`accepted_by` text,
	`completed_by` text,
	`history` text DEFAULT '[]' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`reminder_interval` text,
	`reminder_next_at` integer,
	`timer_sessions` text DEFAULT '[]' NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`depends_on` integer,
	`source` text,
	CONSTRAINT `fk_quests_shelved_by_users_id_fk` FOREIGN KEY (`shelved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_quests_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_quests_chapter_id_chapters_id_fk` FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_quests_petition_id_petitions_id_fk` FOREIGN KEY (`petition_id`) REFERENCES `petitions`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_quests_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_quests_accepted_by_users_id_fk` FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_quests_completed_by_users_id_fk` FOREIGN KEY (`completed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_quests_depends_on_quests_id_fk` FOREIGN KEY (`depends_on`) REFERENCES `quests`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`refresh_token` text NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text,
	`expires_at` integer NOT NULL,
	`last_used_at` integer,
	`ip` text,
	`country` text,
	`user_agent` text,
	CONSTRAINT `fk_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sigil_blight_rate` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`sigil_id` text NOT NULL,
	`ip_hash` text NOT NULL,
	`date` text NOT NULL,
	`fingerprints` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sigil_blights` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`sigil_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`name` text NOT NULL,
	`message` text NOT NULL,
	`stack` text DEFAULT '' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`recent_ips` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`origin` text DEFAULT 'client' NOT NULL,
	CONSTRAINT `fk_sigil_blights_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sigil_unique_visitors` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`sigil_id` text NOT NULL,
	`date` text NOT NULL,
	`session_hash` text NOT NULL,
	CONSTRAINT `fk_sigil_unique_visitors_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sigil_views` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`sigil_id` text NOT NULL,
	`date` text NOT NULL,
	`country` text NOT NULL,
	`path` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `fk_sigil_views_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sigil_vitals` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`sigil_id` text NOT NULL,
	`date` text NOT NULL,
	`path` text NOT NULL,
	`metric` text NOT NULL,
	`bucket` integer NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `fk_sigil_vitals_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sigils` (
	`id` text PRIMARY KEY,
	`ingest_key` text NOT NULL,
	`campaign_id` integer NOT NULL,
	`label` text NOT NULL,
	`allowed_origins` text DEFAULT '[]' NOT NULL,
	`kinds` text DEFAULT '[]' NOT NULL,
	`excluded_paths` text DEFAULT '[]' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`revoked_at` integer,
	CONSTRAINT `fk_sigils_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sigils_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`realm` text DEFAULT 'default' NOT NULL,
	`username` text,
	`email` text,
	`phone_number` text,
	`roles` text DEFAULT '[]' NOT NULL,
	`first_name` text,
	`last_name` text,
	`picture` text,
	`enabled` integer DEFAULT true NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`last_login_at` integer,
	`organization_id` text
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`type` text NOT NULL,
	`target` text NOT NULL,
	`purpose` text DEFAULT 'default' NOT NULL,
	`code` text NOT NULL,
	`verified_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alepha_sequences_name_scope_idx` ON `alepha_sequences` (`name`,`scope`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_user_id_name_idx` ON `api_keys` (`user_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_token_hash_idx` ON `api_keys` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `archive_blobs_campaign_id_short_id_idx` ON `archive_blobs` (`campaign_id`,`short_id`);--> statement-breakpoint
CREATE INDEX `archive_blobs_directory_id_idx` ON `archive_blobs` (`directory_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `archive_directories_campaign_id_short_id_idx` ON `archive_directories` (`campaign_id`,`short_id`);--> statement-breakpoint
CREATE INDEX `archive_directories_parent_id_idx` ON `archive_directories` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `archive_names_parent_directory_id_root_scope_lower_name_idx` ON `archive_names` (`parent_directory_id`,`root_scope`,`lower_name`);--> statement-breakpoint
CREATE INDEX `archive_names_entity_id_idx` ON `archive_names` (`entity_id`);--> statement-breakpoint
CREATE INDEX `audits_created_at_idx` ON `audits` (`created_at`);--> statement-breakpoint
CREATE INDEX `audits_type_idx` ON `audits` (`type`);--> statement-breakpoint
CREATE INDEX `audits_action_idx` ON `audits` (`action`);--> statement-breakpoint
CREATE INDEX `audits_user_id_idx` ON `audits` (`user_id`);--> statement-breakpoint
CREATE INDEX `audits_user_realm_idx` ON `audits` (`user_realm`);--> statement-breakpoint
CREATE INDEX `audits_resource_type_idx` ON `audits` (`resource_type`);--> statement-breakpoint
CREATE INDEX `audits_resource_id_idx` ON `audits` (`resource_id`);--> statement-breakpoint
CREATE INDEX `audits_severity_idx` ON `audits` (`severity`);--> statement-breakpoint
CREATE INDEX `audits_type_action_idx` ON `audits` (`type`,`action`);--> statement-breakpoint
CREATE INDEX `audits_user_id_created_at_idx` ON `audits` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audits_user_realm_created_at_idx` ON `audits` (`user_realm`,`created_at`);--> statement-breakpoint
CREATE INDEX `blight_ignore_rules_campaign_id_idx` ON `blight_ignore_rules` (`campaign_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cache_entries_container_cache_key_idx` ON `cache_entries` (`container`,`cache_key`);--> statement-breakpoint
CREATE INDEX `cache_entries_expires_at_idx` ON `cache_entries` (`expires_at`);--> statement-breakpoint
CREATE INDEX `campaigns_created_by_idx` ON `campaigns` (`created_by`);--> statement-breakpoint
CREATE INDEX `chapters_campaign_id_idx` ON `chapters` (`campaign_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chapters_campaign_id_number_idx` ON `chapters` (`campaign_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `characters_user_id_campaign_id_idx` ON `characters` (`user_id`,`campaign_id`);--> statement-breakpoint
CREATE INDEX `files_expiration_date_idx` ON `files` (`expiration_date`);--> statement-breakpoint
CREATE INDEX `files_bucket_idx` ON `files` (`bucket`);--> statement-breakpoint
CREATE INDEX `files_creator_idx` ON `files` (`creator`);--> statement-breakpoint
CREATE INDEX `files_created_at_idx` ON `files` (`created_at`);--> statement-breakpoint
CREATE INDEX `files_mime_type_idx` ON `files` (`mime_type`);--> statement-breakpoint
CREATE INDEX `files_bucket_created_at_idx` ON `files` (`bucket`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `folio_links_from_id_to_id_idx` ON `folio_links` (`from_id`,`to_id`);--> statement-breakpoint
CREATE INDEX `folio_links_to_id_idx` ON `folio_links` (`to_id`);--> statement-breakpoint
CREATE INDEX `folio_revisions_folio_id_at_idx` ON `folio_revisions` (`folio_id`,`at`);--> statement-breakpoint
CREATE INDEX `folios_campaign_id_updated_at_idx` ON `folios` (`campaign_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `folios_campaign_id_title_idx` ON `folios` (`campaign_id`,`title`);--> statement-breakpoint
CREATE UNIQUE INDEX `folios_campaign_id_short_id_idx` ON `folios` (`campaign_id`,`short_id`);--> statement-breakpoint
CREATE INDEX `identities_user_id_idx` ON `identities` (`user_id`);--> statement-breakpoint
CREATE INDEX `identities_provider_idx` ON `identities` (`provider`);--> statement-breakpoint
CREATE INDEX `identities_user_id_provider_idx` ON `identities` (`user_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `identities_provider_provider_user_id_idx` ON `identities` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE INDEX `invitations_email_status_idx` ON `invitations` (`email`,`status`);--> statement-breakpoint
CREATE INDEX `invitations_resource_type_resource_id_email_status_idx` ON `invitations` (`resource_type`,`resource_id`,`email`,`status`);--> statement-breakpoint
CREATE INDEX `invitations_invited_by_idx` ON `invitations` (`invited_by`);--> statement-breakpoint
CREATE INDEX `invitations_expires_at_idx` ON `invitations` (`expires_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_status_scheduled_at_idx` ON `job_executions` (`job_name`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_status_created_at_idx` ON `job_executions` (`job_name`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_started_at_idx` ON `job_executions` (`job_name`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_executions_job_name_key_idx` ON `job_executions` (`job_name`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_clients_client_id_idx` ON `oauth_clients` (`client_id`);--> statement-breakpoint
CREATE INDEX `parameters_organization_id_name_activation_date_idx` ON `parameters` (`organization_id`,`name`,`activation_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `parameters_organization_id_name_version_idx` ON `parameters` (`organization_id`,`name`,`version`);--> statement-breakpoint
CREATE INDEX `parameters_activation_date_idx` ON `parameters` (`activation_date`);--> statement-breakpoint
CREATE INDEX `petitions_campaign_id_status_deleted_at_idx` ON `petitions` (`campaign_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `petitions_campaign_id_created_at_idx` ON `petitions` (`campaign_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `petitions_campaign_id_short_id_idx` ON `petitions` (`campaign_id`,`short_id`);--> statement-breakpoint
CREATE INDEX `petitions_reporter_user_id_created_at_idx` ON `petitions` (`reporter_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `quests_campaign_id_deleted_at_idx` ON `quests` (`campaign_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `quests_campaign_id_short_id_idx` ON `quests` (`campaign_id`,`short_id`);--> statement-breakpoint
CREATE INDEX `quests_accepted_by_idx` ON `quests` (`accepted_by`);--> statement-breakpoint
CREATE INDEX `quests_completed_by_idx` ON `quests` (`completed_by`);--> statement-breakpoint
CREATE INDEX `quests_chapter_id_idx` ON `quests` (`chapter_id`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_refresh_token_idx` ON `sessions` (`refresh_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `sigil_blight_rate_sigil_id_ip_hash_date_idx` ON `sigil_blight_rate` (`sigil_id`,`ip_hash`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `sigil_blights_sigil_id_fingerprint_idx` ON `sigil_blights` (`sigil_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `sigil_blights_sigil_id_status_idx` ON `sigil_blights` (`sigil_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `sigil_unique_visitors_sigil_id_date_session_hash_idx` ON `sigil_unique_visitors` (`sigil_id`,`date`,`session_hash`);--> statement-breakpoint
CREATE INDEX `sigil_unique_visitors_sigil_id_date_idx` ON `sigil_unique_visitors` (`sigil_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `sigil_views_sigil_id_date_country_path_idx` ON `sigil_views` (`sigil_id`,`date`,`country`,`path`);--> statement-breakpoint
CREATE INDEX `sigil_views_sigil_id_date_idx` ON `sigil_views` (`sigil_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `sigil_vitals_sigil_id_date_path_metric_bucket_idx` ON `sigil_vitals` (`sigil_id`,`date`,`path`,`metric`,`bucket`);--> statement-breakpoint
CREATE INDEX `sigil_vitals_sigil_id_date_metric_idx` ON `sigil_vitals` (`sigil_id`,`date`,`metric`);--> statement-breakpoint
CREATE INDEX `sigils_campaign_id_revoked_at_idx` ON `sigils` (`campaign_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `sigils_created_by_idx` ON `sigils` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_username_lower_idx` ON `users` (`realm`,LOWER("username"));--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_email_idx` ON `users` (`realm`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_phone_number_idx` ON `users` (`realm`,`phone_number`);--> statement-breakpoint
CREATE INDEX `verification_created_at_idx` ON `verification` (`created_at`);--> statement-breakpoint
CREATE INDEX `verification_target_code_idx` ON `verification` (`target`,`code`);