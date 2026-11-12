CREATE TABLE `ai_conversations` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`pending_call_id` text,
	`pending_call` text
);
--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_calls` text,
	`call_id` text,
	`name` text,
	`is_error` integer,
	`vendor` text,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer
);
--> statement-breakpoint
CREATE TABLE `alepha_sequences` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`name` text NOT NULL,
	`scope` text DEFAULT 'default' NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_estate_stats_raw` (
	`time_bucket` text NOT NULL,
	`estate_id` text NOT NULL,
	`cpu` real NOT NULL,
	`memory` real NOT NULL,
	`samples` real NOT NULL,
	CONSTRAINT `fk_analytics_estate_stats_raw_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `analytics_estate_stats_rolled` (
	`time_bucket` text NOT NULL,
	`estate_id` text NOT NULL,
	`cpu` real NOT NULL,
	`memory` real NOT NULL,
	`samples` real NOT NULL,
	CONSTRAINT `fk_analytics_estate_stats_rolled_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `analytics_mcp_calls_raw` (
	`time_bucket` text NOT NULL,
	`tool` text NOT NULL,
	`outcome` text DEFAULT 'ok' NOT NULL,
	`actor` text DEFAULT 'anon' NOT NULL,
	`project` text DEFAULT 'none' NOT NULL,
	`count` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_mcp_calls_rolled` (
	`time_bucket` text NOT NULL,
	`tool` text NOT NULL,
	`outcome` text DEFAULT 'ok' NOT NULL,
	`actor` text DEFAULT 'anon' NOT NULL,
	`project` text DEFAULT 'none' NOT NULL,
	`count` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_project_activity_raw` (
	`time_bucket` text NOT NULL,
	`project` text NOT NULL,
	`type` text NOT NULL,
	`action` text NOT NULL,
	`actor` text DEFAULT 'system' NOT NULL,
	`channel` text DEFAULT 'unknown' NOT NULL,
	`count` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_project_activity_rolled` (
	`time_bucket` text NOT NULL,
	`project` text NOT NULL,
	`type` text NOT NULL,
	`action` text NOT NULL,
	`actor` text DEFAULT 'system' NOT NULL,
	`channel` text DEFAULT 'unknown' NOT NULL,
	`count` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_prune_floors` (
	`dataset` text PRIMARY KEY,
	`floor` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_sigil_errors_raw` (
	`time_bucket` text NOT NULL,
	`sigil_id` text NOT NULL,
	`origin` text DEFAULT 'client' NOT NULL,
	`fingerprint` text DEFAULT '' NOT NULL,
	`count` real NOT NULL,
	CONSTRAINT `fk_analytics_sigil_errors_raw_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `analytics_sigil_errors_rolled` (
	`time_bucket` text NOT NULL,
	`sigil_id` text NOT NULL,
	`origin` text DEFAULT 'client' NOT NULL,
	`fingerprint` text DEFAULT '' NOT NULL,
	`count` real NOT NULL,
	CONSTRAINT `fk_analytics_sigil_errors_rolled_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `analytics_sigil_views_raw` (
	`time_bucket` text NOT NULL,
	`sigil_id` text NOT NULL,
	`path` text NOT NULL,
	`country` text NOT NULL,
	`referrer` text DEFAULT 'direct' NOT NULL,
	`campaign` text DEFAULT 'none' NOT NULL,
	`device` text DEFAULT 'desktop' NOT NULL,
	`traffic` text DEFAULT 'human' NOT NULL,
	`browser` text DEFAULT 'other' NOT NULL,
	`os` text DEFAULT 'other' NOT NULL,
	`auth` text DEFAULT 'anon' NOT NULL,
	`count` real NOT NULL,
	`engaged` real DEFAULT 0 NOT NULL,
	`entries` real DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_analytics_sigil_views_raw_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `analytics_sigil_views_rolled` (
	`time_bucket` text NOT NULL,
	`sigil_id` text NOT NULL,
	`path` text NOT NULL,
	`country` text NOT NULL,
	`referrer` text DEFAULT 'direct' NOT NULL,
	`campaign` text DEFAULT 'none' NOT NULL,
	`device` text DEFAULT 'desktop' NOT NULL,
	`traffic` text DEFAULT 'human' NOT NULL,
	`browser` text DEFAULT 'other' NOT NULL,
	`os` text DEFAULT 'other' NOT NULL,
	`auth` text DEFAULT 'anon' NOT NULL,
	`count` real NOT NULL,
	`engaged` real DEFAULT 0 NOT NULL,
	`entries` real DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_analytics_sigil_views_rolled_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `analytics_sigil_vitals_raw` (
	`time_bucket` text NOT NULL,
	`sigil_id` text NOT NULL,
	`metric` text NOT NULL,
	`path` text NOT NULL,
	`bucket` real NOT NULL,
	`samples` real NOT NULL,
	CONSTRAINT `fk_analytics_sigil_vitals_raw_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `analytics_sigil_vitals_rolled` (
	`time_bucket` text NOT NULL,
	`sigil_id` text NOT NULL,
	`metric` text NOT NULL,
	`path` text NOT NULL,
	`bucket` real NOT NULL,
	`samples` real NOT NULL,
	CONSTRAINT `fk_analytics_sigil_vitals_rolled_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `analytics_uptime_probes_raw` (
	`time_bucket` text NOT NULL,
	`monitor_id` text DEFAULT '00000000-0000-4000-8000-000000000000' NOT NULL,
	`result` text DEFAULT 'up' NOT NULL,
	`prober` text DEFAULT 'local' NOT NULL,
	`count` real NOT NULL,
	`up` real NOT NULL,
	`latency_ms` real NOT NULL,
	CONSTRAINT `fk_analytics_uptime_probes_raw_monitor_id_monitors_id_fk` FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `analytics_uptime_probes_rolled` (
	`time_bucket` text NOT NULL,
	`monitor_id` text DEFAULT '00000000-0000-4000-8000-000000000000' NOT NULL,
	`result` text DEFAULT 'up' NOT NULL,
	`prober` text DEFAULT 'local' NOT NULL,
	`count` real NOT NULL,
	`up` real NOT NULL,
	`latency_ms` real NOT NULL,
	CONSTRAINT `fk_analytics_uptime_probes_rolled_monitor_id_monitors_id_fk` FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`token_suffix` text NOT NULL,
	`roles` text DEFAULT '[]' NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`ip_allowlist` text DEFAULT '[]' NOT NULL,
	`last_used_at` integer,
	`last_used_ip` text,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`rotated_at` integer,
	`expiry_notice_sent_at` integer
);
--> statement-breakpoint
CREATE TABLE `app_instances` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`app` text NOT NULL,
	`env` text NOT NULL,
	`url` text,
	`sigil_id` text,
	`estate_id` text,
	`resources` text,
	`resource_name` text,
	`resource_estate_id` text,
	`ephemeral` integer DEFAULT false NOT NULL,
	`created_by` text,
	`stack_environment_id` text,
	CONSTRAINT `fk_app_instances_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_app_instances_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_app_instances_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_app_instances_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_app_instances_stack_environment_id_stack_environments_id_fk` FOREIGN KEY (`stack_environment_id`) REFERENCES `stack_environments`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `app_secrets` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`instance_id` text NOT NULL,
	`key` text NOT NULL,
	`value_sealed` text NOT NULL,
	`value_prefix` text DEFAULT '' NOT NULL,
	`value` text,
	`key_version` integer DEFAULT 1 NOT NULL,
	`updated_by` text,
	CONSTRAINT `fk_app_secrets_instance_id_app_instances_id_fk` FOREIGN KEY (`instance_id`) REFERENCES `app_instances`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `areas` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text,
	CONSTRAINT `fk_areas_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`app` text NOT NULL,
	`tag` text NOT NULL,
	`runtime` text NOT NULL,
	`runtimes` text,
	`format` text DEFAULT 'archive' NOT NULL,
	`reference` text,
	`sha256` text NOT NULL,
	`size` integer,
	`file_id` text,
	`commit_sha` text,
	`maps_file_id` text,
	`manifest` text,
	CONSTRAINT `fk_artifacts_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`scope_type` text,
	`scope_id` text,
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
	`error_message` text,
	`event_count` integer DEFAULT 1 NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `automation_adoptions` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`policy` text NOT NULL,
	`automation_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`state` text NOT NULL,
	`adopted_at` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_automation_adoptions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_automation_adoptions_automation_id_automations_id_fk` FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_automation_adoptions_author_user_id_users_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `automation_events` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`project_id` integer NOT NULL,
	`identity` text NOT NULL,
	`name` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`replay_until` integer NOT NULL,
	`payload` text NOT NULL,
	`cursor` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`dispatched_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_automation_events_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `automation_receipts` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`project_id` integer NOT NULL,
	`automation_id` text,
	`identity` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`occurrence_id` text NOT NULL,
	`rule_revision` integer NOT NULL,
	`occurred_at` integer NOT NULL,
	`replay_until` integer NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`parent_id` text,
	`run_id` text,
	`input_hash` text,
	`mode` text,
	`snapshot` text,
	`result` text,
	`recipient_user_id` text,
	`recipient_channel` text,
	`position` integer,
	`action_index` integer,
	`row_index` integer,
	`delivery_key` text,
	`cursor` integer DEFAULT 0 NOT NULL,
	`queue_attempts` integer DEFAULT 0 NOT NULL,
	`roster_complete` integer DEFAULT false NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_automation_receipts_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_automation_receipts_automation_id_automations_id_fk` FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "automation_receipts_valid_id" CHECK(id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`project_id` integer NOT NULL,
	`automation_id` text NOT NULL,
	`rule_revision` integer NOT NULL,
	`occurrence_id` text NOT NULL,
	`triggered_at` integer NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`snapshot` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`finished_at` integer,
	CONSTRAINT `fk_automation_runs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_automation_runs_automation_id_automations_id_fk` FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `automation_variables` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`key` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_automation_variables_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`author_user_id` text NOT NULL,
	`author_key_id` text,
	`author_session_id` text,
	`author_scope` text,
	`approved_variables` text DEFAULT '[]' NOT NULL,
	`activated_at` integer,
	`title` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`health` text DEFAULT 'active' NOT NULL,
	`reason` text,
	`health_checked_at` integer DEFAULT 0 NOT NULL,
	`requires_approval` integer DEFAULT false NOT NULL,
	`rule` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`preset_key` text,
	`next_run_at` integer,
	`schedule_cron` text,
	`baseline` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_automations_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_automations_author_user_id_users_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `blight_ignore_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`pattern` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_blight_ignore_rules_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_blight_ignore_rules_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `blights` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`sigil_id` text,
	`fingerprint` text NOT NULL,
	`name` text NOT NULL,
	`message` text NOT NULL,
	`stack` text DEFAULT '' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`origin` text DEFAULT 'client' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	CONSTRAINT `fk_blights_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_blights_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE SET NULL
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
CREATE TABLE `dashboard_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` text NOT NULL,
	`metric` text NOT NULL,
	`scope` text NOT NULL,
	`filters` text DEFAULT '{}' NOT NULL,
	`size` integer DEFAULT 1 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`height` integer,
	`section` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_dashboard_cards_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `dashboard_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` text NOT NULL,
	`seeded_at` text NOT NULL,
	CONSTRAINT `fk_dashboard_settings_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`instance_id` text NOT NULL,
	`artifact_id` text,
	`app` text NOT NULL,
	`tag` text NOT NULL,
	`sha256` text NOT NULL,
	`status` text NOT NULL,
	`version_id` text,
	`migrations_applied` integer,
	`url` text,
	`error` text,
	`log` text DEFAULT '[]' NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`created_by` text,
	`command_id` text,
	CONSTRAINT `fk_deployments_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_deployments_instance_id_app_instances_id_fk` FOREIGN KEY (`instance_id`) REFERENCES `app_instances`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `epic_review_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`review_id` integer NOT NULL,
	`epic_id` integer NOT NULL,
	`number` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`suggestions` text DEFAULT '[]' NOT NULL,
	`recommended` integer,
	`state` text,
	`answer` text,
	`answer_suggestion` integer,
	`answered_by` text,
	`answered_at` integer,
	`replaces` integer,
	`replaced_by` integer,
	`created_by` text,
	`target` text,
	CONSTRAINT `fk_epic_review_items_review_id_epic_reviews_id_fk` FOREIGN KEY (`review_id`) REFERENCES `epic_reviews`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_epic_review_items_epic_id_epics_id_fk` FOREIGN KEY (`epic_id`) REFERENCES `epics`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_epic_review_items_answered_by_users_id_fk` FOREIGN KEY (`answered_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_epic_review_items_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `epic_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`epic_id` integer NOT NULL,
	`created_by` text,
	`summary` text DEFAULT '' NOT NULL,
	CONSTRAINT `fk_epic_reviews_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_epic_reviews_epic_id_epics_id_fk` FOREIGN KEY (`epic_id`) REFERENCES `epics`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_epic_reviews_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `epics` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`project_id` integer NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`release_id` integer,
	`depends_on` integer,
	CONSTRAINT `fk_epics_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_epics_release_id_releases_id_fk` FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_epics_depends_on_epics_id_fk` FOREIGN KEY (`depends_on`) REFERENCES `epics`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `estate_commands` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`estate_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload` text NOT NULL,
	`requested_by` text,
	`timeout_seconds` integer NOT NULL,
	`sent_at` text,
	`running_at` text,
	`finished_at` text,
	`step` text,
	`reason` text,
	`result_file_id` text,
	CONSTRAINT `fk_estate_commands_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_estate_commands_requested_by_users_id_fk` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `estate_events` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`estate_id` text NOT NULL,
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`app` text,
	`env` text,
	`at` text NOT NULL,
	`data` text,
	CONSTRAINT `fk_estate_events_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `estate_inventories` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`estate_id` text NOT NULL,
	`at` text NOT NULL,
	`reported_at` text NOT NULL,
	`bay_version` text,
	`host` text NOT NULL,
	`apps` text NOT NULL,
	`app_count` integer NOT NULL,
	`stacks` text,
	CONSTRAINT `fk_estate_inventories_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `estate_projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`estate_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`created_by` text,
	CONSTRAINT `fk_estate_projects_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_estate_projects_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_estate_projects_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `estates` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`owner_user_id` text NOT NULL,
	`project_id` integer,
	`created_by` text,
	`type` text NOT NULL,
	`slug` text NOT NULL,
	`label` text,
	`secret_hash` text,
	`secret_prefix` text,
	`credential` text,
	`credential_key_version` integer,
	`account_id` text,
	`credential_checked_at` text,
	`credential_error` text,
	`credential_expires_at` text,
	`collect_series` integer DEFAULT false NOT NULL,
	`deploy_allowed` integer DEFAULT false NOT NULL,
	`stats_interval_seconds` integer DEFAULT 1800 NOT NULL,
	`connected_at` text,
	`disconnected_at` text,
	`connection_id` text,
	`last_seen_at` text,
	`public_ip` text,
	`expires_at` text,
	`notified_overdue_at` text,
	`enrolment_hash` text,
	`enrolment_expires_at` text,
	`provider` text,
	`provider_server_id` text,
	`provider_server_type` text,
	`provider_zone` text,
	`hourly_price` real,
	`provisioned_at` text,
	`cpu_percent` real,
	`memory_percent` real,
	`stats_at` text,
	CONSTRAINT `fk_estates_owner_user_id_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_estates_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_estates_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`short_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`project_id` integer NOT NULL,
	`reporter_user_id` text,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`triaged_at` integer,
	`triaged_by` text,
	`attachments` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`source` text,
	CONSTRAINT `fk_feedback_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_feedback_reporter_user_id_users_id_fk` FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_feedback_triaged_by_users_id_fk` FOREIGN KEY (`triaged_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `feedback_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`feedback_id` integer NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`edited_at` integer,
	`source` text,
	CONSTRAINT `fk_feedback_comments_feedback_id_feedback_id_fk` FOREIGN KEY (`feedback_id`) REFERENCES `feedback`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_feedback_comments_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
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
CREATE TABLE `folio_blobs` (
	`file_id` text PRIMARY KEY,
	`short_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`folio_id` text NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT `fk_folio_blobs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_folio_blobs_folio_id_folios_id_fk` FOREIGN KEY (`folio_id`) REFERENCES `folios`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `folio_directories` (
	`id` text PRIMARY KEY,
	`short_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	CONSTRAINT `fk_folio_directories_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_folio_directories_parent_id_folio_directories_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `folio_directories`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `folio_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`from_type` text DEFAULT 'folio' NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`target_type` text DEFAULT 'folio' NOT NULL,
	`relation` text
);
--> statement-breakpoint
CREATE TABLE `folio_names` (
	`id` text PRIMARY KEY,
	`parent_directory_id` text,
	`root_scope` text,
	`lower_name` text NOT NULL,
	`kind` text NOT NULL,
	`entity_id` text NOT NULL
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
	`snapshot_is_live` integer DEFAULT false NOT NULL,
	`title_snapshot` text NOT NULL,
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
	`version` integer DEFAULT 0 NOT NULL,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`directory_id` text,
	`summary` text DEFAULT '' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	CONSTRAINT `fk_folios_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_folios_directory_id_folio_directories_id_fk` FOREIGN KEY (`directory_id`) REFERENCES `folio_directories`(`id`) ON DELETE CASCADE
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
CREATE TABLE `job_cron_claims` (
	`id` text PRIMARY KEY,
	`job_name` text NOT NULL,
	`instant` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_executions` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`job_name` text NOT NULL,
	`key` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 1 NOT NULL,
	`redispatch_count` integer DEFAULT 0 NOT NULL,
	`payload` text,
	`scheduled_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`error` text,
	`logs` text,
	`steps` text,
	`triggered_by` text,
	`triggered_by_name` text,
	`cancelled_by` text,
	`cancelled_by_name` text
);
--> statement-breakpoint
CREATE TABLE `monitor_heartbeats` (
	`id` text PRIMARY KEY,
	`monitor_id` text NOT NULL,
	`at` text NOT NULL,
	`ok` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`error` text,
	CONSTRAINT `fk_monitor_heartbeats_monitor_id_monitors_id_fk` FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `monitor_incidents` (
	`id` text PRIMARY KEY,
	`monitor_id` text NOT NULL,
	`started_at` text NOT NULL,
	`open_key` text,
	`ended_at` text,
	`cause` text NOT NULL,
	`last_error` text,
	CONSTRAINT `fk_monitor_incidents_monitor_id_monitors_id_fk` FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `monitors` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`project_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`push_token_hash` text,
	`interval_secs` integer DEFAULT 60 NOT NULL,
	`timeout_secs` integer DEFAULT 10 NOT NULL,
	`confirmations` integer DEFAULT 2 NOT NULL,
	`expect` text DEFAULT '{}' NOT NULL,
	`notifications` text DEFAULT '{"email":true,"recipients":[]}' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`status_since` text NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`last_checked_at` text,
	`last_pushed_at` text,
	`last_result` text,
	`next_check_at` text NOT NULL,
	`last_latency_ms` integer,
	`last_error` text,
	`cert_expires_at` text,
	CONSTRAINT `fk_monitors_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`execution_id` text NOT NULL,
	`message_id` text,
	`provider` text NOT NULL,
	`channel` text NOT NULL,
	`contact` text NOT NULL,
	`template` text NOT NULL,
	`category` text,
	`critical` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`skip_reason` text,
	`subject` text,
	`body` text,
	`last_event_at` integer,
	`smtp_status_code` text,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `notification_inbox` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`scope` text,
	`scope_label` text,
	`template` text NOT NULL,
	`category` text,
	`title` text NOT NULL,
	`body` text,
	`href` text NOT NULL,
	`read_at` integer
);
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`email_enabled` integer DEFAULT true NOT NULL,
	`muted_categories` text DEFAULT '[]' NOT NULL,
	CONSTRAINT `fk_notification_preferences_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `notification_suppressions` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`contact` text NOT NULL,
	`channel` text NOT NULL,
	`reason` text NOT NULL,
	`category` text DEFAULT '*' NOT NULL,
	`source` text NOT NULL
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
	`application_type` text,
	`metadata_expires_at` integer,
	`created_by_user_id` text,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE TABLE `organization_invitations` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text NOT NULL,
	`invited_by` text NOT NULL,
	`email` text NOT NULL,
	`status` text NOT NULL,
	`rank` text,
	`metadata` text,
	`expires_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	CONSTRAINT `fk_organization_invitations_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `organization_members` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`rank` text,
	CONSTRAINT `fk_organization_members_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_organization_members_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `organization_ranks` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`builtin` integer DEFAULT false NOT NULL,
	`permissions` text NOT NULL,
	CONSTRAINT `fk_organization_ranks_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`name` text NOT NULL,
	`slug` text,
	`logo` text,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `parameters` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
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
CREATE TABLE `project_capabilities` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`key` text NOT NULL,
	`enabled_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	CONSTRAINT `fk_project_capabilities_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `project_dashboard_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`dashboard_id` integer,
	`metric` text NOT NULL,
	`scope` text NOT NULL,
	`filters` text DEFAULT '{}' NOT NULL,
	`size` integer DEFAULT 1 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`height` integer,
	`section` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_project_dashboard_cards_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_dashboard_cards_dashboard_id_project_dashboards_id_fk` FOREIGN KEY (`dashboard_id`) REFERENCES `project_dashboards`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `project_dashboards` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`name` text,
	`slug` text,
	`position` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_project_dashboards_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `project_prompts` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`kind` text NOT NULL,
	`template` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_project_prompts_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`title` text NOT NULL,
	`slug` text,
	`created_by` text NOT NULL,
	`organization_id` text,
	`icon` text,
	`preferred_language` text,
	`repository_url` text,
	`retention_days` integer,
	`coverage_target` integer,
	`kanban_columns` text DEFAULT '["In Progress"]' NOT NULL,
	`kanban_column_config` text,
	`roadmap_visibility` text,
	`tag_colors` text,
	`archived_at` integer,
	CONSTRAINT `fk_projects_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `quality_runs` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`day` text NOT NULL,
	`commit_sha` text NOT NULL,
	`branch` text NOT NULL,
	`coverage_lines` real NOT NULL,
	`coverage_statements` real NOT NULL,
	`coverage_functions` real NOT NULL,
	`coverage_branches` real NOT NULL,
	`tests_total` integer NOT NULL,
	`tests_passed` integer NOT NULL,
	`tests_failed` integer NOT NULL,
	`tests_skipped` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	CONSTRAINT `fk_quality_runs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `quest_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`quest_id` integer NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`edited_at` integer,
	`source` text,
	CONSTRAINT `fk_quest_comments_quest_id_quests_id_fk` FOREIGN KEY (`quest_id`) REFERENCES `quests`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_quest_comments_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `quest_flow_daily` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`day` text NOT NULL,
	`dimension` text NOT NULL,
	`subject` text NOT NULL,
	`todo` integer NOT NULL,
	`in_progress` integer NOT NULL,
	`on_hold` integer NOT NULL,
	`done` integer NOT NULL,
	CONSTRAINT `fk_quest_flow_daily_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `quests` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`short_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`area` text NOT NULL,
	`priority` text NOT NULL,
	`size` integer DEFAULT 3 NOT NULL,
	`estimate_minutes` integer,
	`accepted_at` integer,
	`completed_at` integer,
	`due_at` integer,
	`board_rank` text,
	`shelved_at` integer,
	`shelved_by` text,
	`shelved_with_epic` integer,
	`held_at` integer,
	`held_by` text,
	`completion_message` text,
	`completion_message_updated_at` integer,
	`kanban_column` text,
	`objectives` text DEFAULT '[]' NOT NULL,
	`project_id` integer NOT NULL,
	`release_id` integer,
	`feedback_id` integer,
	`created_by` text NOT NULL,
	`accepted_by` text,
	`completed_by` text,
	`history` text DEFAULT '[]' NOT NULL,
	`reminder_interval` text,
	`reminder_next_at` integer,
	`timer_sessions` text DEFAULT '[]' NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`depends_on` integer,
	`epic_id` integer,
	`source` text,
	`commits` text,
	CONSTRAINT `fk_quests_shelved_by_users_id_fk` FOREIGN KEY (`shelved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_quests_held_by_users_id_fk` FOREIGN KEY (`held_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_quests_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_quests_release_id_releases_id_fk` FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_quests_feedback_id_feedback_id_fk` FOREIGN KEY (`feedback_id`) REFERENCES `feedback`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_quests_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_quests_accepted_by_users_id_fk` FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_quests_completed_by_users_id_fk` FOREIGN KEY (`completed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_quests_depends_on_quests_id_fk` FOREIGN KEY (`depends_on`) REFERENCES `quests`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_quests_epic_id_epics_id_fk` FOREIGN KEY (`epic_id`) REFERENCES `epics`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `registry_credentials` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`host` text NOT NULL,
	`username` text NOT NULL,
	`secret_sealed` text NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`updated_by` text,
	CONSTRAINT `fk_registry_credentials_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`number` integer NOT NULL,
	`tag` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`target_date` integer,
	`released_at` integer,
	`default_since` integer,
	`changelog` text,
	`changelog_groups` text,
	`completed` integer,
	`in_progress` integer,
	`shelved` integer,
	`total` integer,
	CONSTRAINT `fk_releases_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
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
	`scopes` text,
	`resource` text,
	`expires_at` integer NOT NULL,
	`last_used_at` integer,
	`ip` text,
	`country` text,
	`user_agent` text,
	CONSTRAINT `fk_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sigil_error_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`sigil_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`name` text NOT NULL,
	`message` text NOT NULL,
	`stack_sample` text NOT NULL,
	`source_url` text NOT NULL,
	`origin` text DEFAULT 'client' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `fk_sigil_error_groups_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sigil_uniques_daily` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`sigil_id` text NOT NULL,
	`day` text NOT NULL,
	`visitor_hash` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`traffic` text DEFAULT 'human' NOT NULL,
	CONSTRAINT `fk_sigil_uniques_daily_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sigils` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`kinds` text DEFAULT '[]' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_seen_at` text,
	`last_seen_host` text,
	`reported_config` text,
	`reported_config_at` text,
	CONSTRAINT `fk_sigils_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sigils_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `stack_deployments` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`environment_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`revision` integer NOT NULL,
	`sha256` text NOT NULL,
	`estate_id` text NOT NULL,
	`command_id` text NOT NULL,
	`status` text NOT NULL,
	`step` text,
	`error` text,
	`plan` text,
	`services` text,
	`warnings` text,
	`finished_at` integer,
	`created_by` text,
	CONSTRAINT `fk_stack_deployments_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_stack_deployments_environment_id_stack_environments_id_fk` FOREIGN KEY (`environment_id`) REFERENCES `stack_environments`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `stack_environment_routes` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`environment_id` text NOT NULL,
	`service` text NOT NULL,
	`domain` text NOT NULL,
	CONSTRAINT `fk_stack_environment_routes_environment_id_stack_environments_id_fk` FOREIGN KEY (`environment_id`) REFERENCES `stack_environments`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `stack_environments` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`stack_id` text NOT NULL,
	`env` text NOT NULL,
	`estate_id` text,
	`base_domain` text,
	`revision` integer,
	CONSTRAINT `fk_stack_environments_stack_id_stacks_id_fk` FOREIGN KEY (`stack_id`) REFERENCES `stacks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_stack_environments_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `stack_revisions` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`stack_id` text NOT NULL,
	`number` integer NOT NULL,
	`file_id` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`model` text NOT NULL,
	`compose` text NOT NULL,
	`digests` text,
	`created_by` text,
	CONSTRAINT `fk_stack_revisions_stack_id_stacks_id_fk` FOREIGN KEY (`stack_id`) REFERENCES `stacks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_stack_revisions_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `stack_variables` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`environment_id` text NOT NULL,
	`key` text NOT NULL,
	`value_sealed` text NOT NULL,
	`value_prefix` text DEFAULT '' NOT NULL,
	`generated` integer DEFAULT false NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`updated_by` text,
	CONSTRAINT `fk_stack_variables_environment_id_stack_environments_id_fk` FOREIGN KEY (`environment_id`) REFERENCES `stack_environments`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `stacks` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`estate_id` text,
	`created_by` text,
	CONSTRAINT `fk_stacks_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_stacks_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_stacks_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `user_docks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`project_ids` text DEFAULT '[]' NOT NULL,
	`seeded_at` integer NOT NULL,
	CONSTRAINT `fk_user_docks_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`realm` text DEFAULT 'users' NOT NULL,
	`username` text,
	`email` text,
	`phone_number` text,
	`roles` text DEFAULT '[]' NOT NULL,
	`first_name` text,
	`last_name` text,
	`picture` text,
	`enabled` integer DEFAULT true NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`last_login_at` integer
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
	`expires_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_conversations_user_id_updated_at_idx` ON `ai_conversations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ai_conversations_updated_at_idx` ON `ai_conversations` (`updated_at`);--> statement-breakpoint
CREATE INDEX `ai_messages_user_id_created_at_idx` ON `ai_messages` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_messages_conversation_id_seq_idx` ON `ai_messages` (`conversation_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `alepha_sequences_name_scope_idx` ON `alepha_sequences` (`name`,`scope`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_estate_stats_raw_time_bucket_estate_id_idx` ON `analytics_estate_stats_raw` (`time_bucket`,`estate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_estate_stats_rolled_time_bucket_estate_id_idx` ON `analytics_estate_stats_rolled` (`time_bucket`,`estate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_mcp_calls_raw_time_bucket_actor_outcome_project_tool_idx` ON `analytics_mcp_calls_raw` (`time_bucket`,`actor`,`outcome`,`project`,`tool`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_mcp_calls_rolled_time_bucket_actor_outcome_project_tool_idx` ON `analytics_mcp_calls_rolled` (`time_bucket`,`actor`,`outcome`,`project`,`tool`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_project_activity_raw_time_bucket_action_actor_channel_project_type_idx` ON `analytics_project_activity_raw` (`time_bucket`,`action`,`actor`,`channel`,`project`,`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_project_activity_rolled_time_bucket_action_actor_channel_project_type_idx` ON `analytics_project_activity_rolled` (`time_bucket`,`action`,`actor`,`channel`,`project`,`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_errors_raw_time_bucket_fingerprint_origin_sigil_id_idx` ON `analytics_sigil_errors_raw` (`time_bucket`,`fingerprint`,`origin`,`sigil_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_errors_rolled_time_bucket_fingerprint_origin_sigil_id_idx` ON `analytics_sigil_errors_rolled` (`time_bucket`,`fingerprint`,`origin`,`sigil_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_views_raw_time_bucket_auth_browser_campaign_country_device_os_path_referrer_sigil_id_traffic_idx` ON `analytics_sigil_views_raw` (`time_bucket`,`auth`,`browser`,`campaign`,`country`,`device`,`os`,`path`,`referrer`,`sigil_id`,`traffic`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_views_rolled_time_bucket_auth_browser_campaign_country_device_os_path_referrer_sigil_id_traffic_idx` ON `analytics_sigil_views_rolled` (`time_bucket`,`auth`,`browser`,`campaign`,`country`,`device`,`os`,`path`,`referrer`,`sigil_id`,`traffic`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_vitals_raw_time_bucket_bucket_metric_path_sigil_id_idx` ON `analytics_sigil_vitals_raw` (`time_bucket`,`bucket`,`metric`,`path`,`sigil_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_vitals_rolled_time_bucket_bucket_metric_path_sigil_id_idx` ON `analytics_sigil_vitals_rolled` (`time_bucket`,`bucket`,`metric`,`path`,`sigil_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_uptime_probes_raw_time_bucket_monitor_id_prober_result_idx` ON `analytics_uptime_probes_raw` (`time_bucket`,`monitor_id`,`prober`,`result`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_uptime_probes_rolled_time_bucket_monitor_id_prober_result_idx` ON `analytics_uptime_probes_rolled` (`time_bucket`,`monitor_id`,`prober`,`result`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_user_id_name_live_idx` ON `api_keys` (`user_id`,`name`) WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_token_hash_idx` ON `api_keys` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `app_instances_project_id_app_env_idx` ON `app_instances` (`project_id`,`app`,`env`);--> statement-breakpoint
CREATE INDEX `app_instances_project_id_idx` ON `app_instances` (`project_id`);--> statement-breakpoint
CREATE INDEX `app_instances_sigil_id_idx` ON `app_instances` (`sigil_id`);--> statement-breakpoint
CREATE INDEX `app_instances_estate_id_idx` ON `app_instances` (`estate_id`);--> statement-breakpoint
CREATE INDEX `app_instances_stack_environment_id_idx` ON `app_instances` (`stack_environment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `app_secrets_instance_id_key_idx` ON `app_secrets` (`instance_id`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `areas_project_id_name_idx` ON `areas` (`project_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_project_id_app_tag_runtime_format_idx` ON `artifacts` (`project_id`,`app`,`tag`,`runtime`,`format`);--> statement-breakpoint
CREATE INDEX `artifacts_project_id_tag_idx` ON `artifacts` (`project_id`,`tag`);--> statement-breakpoint
CREATE INDEX `artifacts_project_id_app_idx` ON `artifacts` (`project_id`,`app`);--> statement-breakpoint
CREATE INDEX `audits_scope_type_scope_id_created_at_idx` ON `audits` (`scope_type`,`scope_id`,`created_at`) WHERE scope_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `audits_scope_type_scope_id_user_id_created_at_idx` ON `audits` (`scope_type`,`scope_id`,`user_id`,`created_at`) WHERE scope_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `audits_scope_type_scope_id_type_action_created_at_idx` ON `audits` (`scope_type`,`scope_id`,`type`,`action`,`created_at`) WHERE scope_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `audits_scope_type_scope_id_action_created_at_idx` ON `audits` (`scope_type`,`scope_id`,`action`,`created_at`) WHERE scope_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `audits_created_at_idx` ON `audits` (`created_at`);--> statement-breakpoint
CREATE INDEX `audits_type_action_created_at_idx` ON `audits` (`type`,`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `audits_user_id_created_at_idx` ON `audits` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audits_user_realm_created_at_idx` ON `audits` (`user_realm`,`created_at`);--> statement-breakpoint
CREATE INDEX `audits_resource_type_resource_id_created_at_idx` ON `audits` (`resource_type`,`resource_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `automation_adoptions_project_id_policy_idx` ON `automation_adoptions` (`project_id`,`policy`);--> statement-breakpoint
CREATE INDEX `automation_adoptions_automation_id_idx` ON `automation_adoptions` (`automation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `automation_events_project_id_identity_idx` ON `automation_events` (`project_id`,`identity`);--> statement-breakpoint
CREATE INDEX `automation_events_dispatched_at_attempts_created_at_id_idx` ON `automation_events` (`dispatched_at`,`attempts`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `automation_events_replay_until_id_idx` ON `automation_events` (`replay_until`,`id`);--> statement-breakpoint
CREATE INDEX `automation_receipts_rule_state_idx` ON `automation_receipts` (`automation_id`,`kind`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `automation_receipts_project_id_identity_idx` ON `automation_receipts` (`project_id`,`identity`);--> statement-breakpoint
CREATE UNIQUE INDEX `automation_receipts_running_rule` ON `automation_receipts` (`automation_id`) WHERE kind = 'occurrence' AND status = 'claimed';--> statement-breakpoint
CREATE INDEX `automation_receipts_kind_status_lease_until_id_idx` ON `automation_receipts` (`kind`,`status`,`lease_until`,`id`);--> statement-breakpoint
CREATE INDEX `automation_receipts_parent_id_kind_position_idx` ON `automation_receipts` (`parent_id`,`kind`,`position`);--> statement-breakpoint
CREATE INDEX `automation_receipts_kind_status_queue_attempts_created_at_id_idx` ON `automation_receipts` (`kind`,`status`,`queue_attempts`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `automation_receipts_project_id_kind_created_at_id_idx` ON `automation_receipts` (`project_id`,`kind`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `automation_receipts_replay_until_status_id_idx` ON `automation_receipts` (`replay_until`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `automation_runs_automation_id_created_at_id_idx` ON `automation_runs` (`automation_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `automation_runs_project_id_created_at_id_idx` ON `automation_runs` (`project_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `automation_runs_finished_at_id_idx` ON `automation_runs` (`finished_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `automation_variables_project_id_key_idx` ON `automation_variables` (`project_id`,`key`);--> statement-breakpoint
CREATE INDEX `automations_enabled_health_next_run_at_id_idx` ON `automations` (`enabled`,`health`,`next_run_at`,`id`);--> statement-breakpoint
CREATE INDEX `automations_project_id_author_user_id_idx` ON `automations` (`project_id`,`author_user_id`);--> statement-breakpoint
CREATE INDEX `automations_health_checked_at_id_idx` ON `automations` (`health_checked_at`,`id`);--> statement-breakpoint
CREATE INDEX `automations_author_user_id_idx` ON `automations` (`author_user_id`);--> statement-breakpoint
CREATE INDEX `blight_ignore_rules_project_id_idx` ON `blight_ignore_rules` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `blights_project_id_fingerprint_idx` ON `blights` (`project_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `blights_project_id_last_seen_at_idx` ON `blights` (`project_id`,`last_seen_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `cache_entries_container_cache_key_idx` ON `cache_entries` (`container`,`cache_key`);--> statement-breakpoint
CREATE INDEX `cache_entries_expires_at_idx` ON `cache_entries` (`expires_at`);--> statement-breakpoint
CREATE INDEX `dashboard_cards_user_id_position_idx` ON `dashboard_cards` (`user_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `dashboard_settings_user_id_idx` ON `dashboard_settings` (`user_id`);--> statement-breakpoint
CREATE INDEX `deployments_instance_id_idx` ON `deployments` (`instance_id`);--> statement-breakpoint
CREATE INDEX `deployments_project_id_idx` ON `deployments` (`project_id`);--> statement-breakpoint
CREATE INDEX `deployments_instance_id_status_created_at_idx` ON `deployments` (`instance_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `deployments_project_id_created_at_idx` ON `deployments` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `deployments_command_id_idx` ON `deployments` (`command_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `epic_review_items_epic_id_number_idx` ON `epic_review_items` (`epic_id`,`number`);--> statement-breakpoint
CREATE INDEX `epic_review_items_review_id_idx` ON `epic_review_items` (`review_id`);--> statement-breakpoint
CREATE INDEX `epic_reviews_epic_id_created_at_idx` ON `epic_reviews` (`epic_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `epics_project_id_number_idx` ON `epics` (`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `epics_project_id_status_idx` ON `epics` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `epics_release_id_idx` ON `epics` (`release_id`);--> statement-breakpoint
CREATE INDEX `epics_project_id_updated_at_idx` ON `epics` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `estate_commands_estate_id_status_idx` ON `estate_commands` (`estate_id`,`status`);--> statement-breakpoint
CREATE INDEX `estate_commands_estate_id_created_at_idx` ON `estate_commands` (`estate_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `estate_events_estate_id_event_id_idx` ON `estate_events` (`estate_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `estate_events_estate_id_app_env_at_idx` ON `estate_events` (`estate_id`,`app`,`env`,`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `estate_inventories_estate_id_idx` ON `estate_inventories` (`estate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `estate_projects_estate_id_project_id_idx` ON `estate_projects` (`estate_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `estate_projects_project_id_idx` ON `estate_projects` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `estates_project_id_slug_idx` ON `estates` (`project_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `estates_secret_hash_idx` ON `estates` (`secret_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `estates_enrolment_hash_idx` ON `estates` (`enrolment_hash`);--> statement-breakpoint
CREATE INDEX `feedback_project_id_status_deleted_at_idx` ON `feedback` (`project_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `feedback_project_id_created_at_idx` ON `feedback` (`project_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_project_id_short_id_idx` ON `feedback` (`project_id`,`short_id`);--> statement-breakpoint
CREATE INDEX `feedback_reporter_user_id_created_at_idx` ON `feedback` (`reporter_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `feedback_comments_feedback_id_created_at_idx` ON `feedback_comments` (`feedback_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `files_expiration_date_idx` ON `files` (`expiration_date`);--> statement-breakpoint
CREATE INDEX `files_bucket_idx` ON `files` (`bucket`);--> statement-breakpoint
CREATE INDEX `files_creator_idx` ON `files` (`creator`);--> statement-breakpoint
CREATE INDEX `files_created_at_idx` ON `files` (`created_at`);--> statement-breakpoint
CREATE INDEX `files_mime_type_idx` ON `files` (`mime_type`);--> statement-breakpoint
CREATE INDEX `files_bucket_created_at_idx` ON `files` (`bucket`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `folio_blobs_project_id_short_id_idx` ON `folio_blobs` (`project_id`,`short_id`);--> statement-breakpoint
CREATE INDEX `folio_blobs_folio_id_idx` ON `folio_blobs` (`folio_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `folio_directories_project_id_short_id_idx` ON `folio_directories` (`project_id`,`short_id`);--> statement-breakpoint
CREATE INDEX `folio_directories_parent_id_idx` ON `folio_directories` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `folio_links_from_type_from_id_target_type_to_id_relation_idx` ON `folio_links` (`from_type`,`from_id`,`target_type`,`to_id`,`relation`);--> statement-breakpoint
CREATE INDEX `folio_links_to_id_idx` ON `folio_links` (`to_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `folio_names_parent_directory_id_root_scope_lower_name_idx` ON `folio_names` (`parent_directory_id`,`root_scope`,`lower_name`);--> statement-breakpoint
CREATE INDEX `folio_names_entity_id_idx` ON `folio_names` (`entity_id`);--> statement-breakpoint
CREATE INDEX `folio_revisions_folio_id_at_idx` ON `folio_revisions` (`folio_id`,`at`);--> statement-breakpoint
CREATE INDEX `folio_revisions_at_idx` ON `folio_revisions` (`at`);--> statement-breakpoint
CREATE INDEX `folios_project_id_updated_at_idx` ON `folios` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `folios_project_id_title_idx` ON `folios` (`project_id`,`title`);--> statement-breakpoint
CREATE UNIQUE INDEX `folios_project_id_short_id_idx` ON `folios` (`project_id`,`short_id`);--> statement-breakpoint
CREATE INDEX `identities_user_id_idx` ON `identities` (`user_id`);--> statement-breakpoint
CREATE INDEX `identities_provider_idx` ON `identities` (`provider`);--> statement-breakpoint
CREATE INDEX `identities_user_id_provider_idx` ON `identities` (`user_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `identities_provider_provider_user_id_idx` ON `identities` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE INDEX `job_executions_status_scheduled_at_idx` ON `job_executions` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `job_executions_status_updated_at_idx` ON `job_executions` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_status_scheduled_at_idx` ON `job_executions` (`job_name`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_status_created_at_idx` ON `job_executions` (`job_name`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_started_at_idx` ON `job_executions` (`job_name`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_executions_job_name_key_idx` ON `job_executions` (`job_name`,`key`);--> statement-breakpoint
CREATE INDEX `monitor_heartbeats_monitor_id_at_idx` ON `monitor_heartbeats` (`monitor_id`,`at`);--> statement-breakpoint
CREATE INDEX `monitor_incidents_monitor_id_started_at_idx` ON `monitor_incidents` (`monitor_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `monitor_incidents_open_key_idx` ON `monitor_incidents` (`open_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `monitors_push_token_hash_idx` ON `monitors` (`push_token_hash`);--> statement-breakpoint
CREATE INDEX `monitors_project_id_idx` ON `monitors` (`project_id`);--> statement-breakpoint
CREATE INDEX `monitors_active_next_check_at_idx` ON `monitors` (`active`,`next_check_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_deliveries_execution_id_idx` ON `notification_deliveries` (`execution_id`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_message_id_idx` ON `notification_deliveries` (`message_id`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_created_at_idx` ON `notification_deliveries` (`created_at`);--> statement-breakpoint
CREATE INDEX `notification_inbox_user_id_read_at_created_at_idx` ON `notification_inbox` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `notification_inbox_user_id_scope_created_at_idx` ON `notification_inbox` (`user_id`,`scope`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_preferences_user_id_idx` ON `notification_preferences` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_suppressions_channel_contact_reason_category_idx` ON `notification_suppressions` (`channel`,`contact`,`reason`,`category`);--> statement-breakpoint
CREATE INDEX `notification_suppressions_channel_contact_idx` ON `notification_suppressions` (`channel`,`contact`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_clients_client_id_idx` ON `oauth_clients` (`client_id`);--> statement-breakpoint
CREATE INDEX `organization_invitations_email_status_idx` ON `organization_invitations` (`email`,`status`);--> statement-breakpoint
CREATE INDEX `organization_invitations_organization_id_email_status_idx` ON `organization_invitations` (`organization_id`,`email`,`status`);--> statement-breakpoint
CREATE INDEX `organization_invitations_invited_by_idx` ON `organization_invitations` (`invited_by`);--> statement-breakpoint
CREATE INDEX `organization_invitations_expires_at_idx` ON `organization_invitations` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_members_organization_id_user_id_idx` ON `organization_members` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_ranks_organization_id_key_idx` ON `organization_ranks` (`organization_id`,`key`);--> statement-breakpoint
CREATE INDEX `organization_ranks_organization_id_idx` ON `organization_ranks` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_idx` ON `organizations` (`slug`);--> statement-breakpoint
CREATE INDEX `parameters_name_activation_date_idx` ON `parameters` (`name`,`activation_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `parameters_name_version_idx` ON `parameters` (`name`,`version`);--> statement-breakpoint
CREATE INDEX `parameters_activation_date_idx` ON `parameters` (`activation_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_capabilities_project_id_key_idx` ON `project_capabilities` (`project_id`,`key`);--> statement-breakpoint
CREATE INDEX `project_dashboard_cards_project_id_position_idx` ON `project_dashboard_cards` (`project_id`,`position`);--> statement-breakpoint
CREATE INDEX `project_dashboard_cards_dashboard_id_position_idx` ON `project_dashboard_cards` (`dashboard_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_dashboards_project_id_slug_idx` ON `project_dashboards` (`project_id`,`slug`);--> statement-breakpoint
CREATE INDEX `project_dashboards_project_id_position_idx` ON `project_dashboards` (`project_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_prompts_project_id_kind_idx` ON `project_prompts` (`project_id`,`kind`);--> statement-breakpoint
CREATE INDEX `projects_created_by_idx` ON `projects` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_idx` ON `projects` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `quality_runs_project_id_branch_day_idx` ON `quality_runs` (`project_id`,`branch`,`day`);--> statement-breakpoint
CREATE INDEX `quality_runs_project_id_day_idx` ON `quality_runs` (`project_id`,`day`);--> statement-breakpoint
CREATE INDEX `quest_comments_created_at_idx` ON `quest_comments` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `quest_flow_daily_project_id_dimension_subject_day_idx` ON `quest_flow_daily` (`project_id`,`dimension`,`subject`,`day`);--> statement-breakpoint
CREATE INDEX `quest_flow_daily_project_id_day_idx` ON `quest_flow_daily` (`project_id`,`day`);--> statement-breakpoint
CREATE INDEX `quests_automation_reminders_idx` ON `quests` (`project_id`,`reminder_next_at`,`short_id`) WHERE ((("quests"."deleted_at" is null)) and (("quests"."completed_at" is null)) and (("quests"."shelved_at" is null)) and (("quests"."accepted_at" is not null)) and (("quests"."accepted_by" is not null)) and (("quests"."reminder_interval" is not null)));--> statement-breakpoint
CREATE INDEX `quests_project_id_deleted_at_idx` ON `quests` (`project_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `quests_project_id_short_id_idx` ON `quests` (`project_id`,`short_id`);--> statement-breakpoint
CREATE INDEX `quests_accepted_by_idx` ON `quests` (`accepted_by`);--> statement-breakpoint
CREATE INDEX `quests_completed_by_idx` ON `quests` (`completed_by`);--> statement-breakpoint
CREATE INDEX `quests_release_id_idx` ON `quests` (`release_id`);--> statement-breakpoint
CREATE INDEX `quests_epic_id_idx` ON `quests` (`epic_id`);--> statement-breakpoint
CREATE INDEX `quests_project_id_updated_at_idx` ON `quests` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `quests_open_idx` ON `quests` (`project_id`,`deleted_at`,`completed_at`,`shelved_at`,`epic_id`) WHERE ((("quests"."deleted_at" is null)) and (("quests"."completed_at" is null)) and (("quests"."shelved_at" is null)));--> statement-breakpoint
CREATE UNIQUE INDEX `registry_credentials_project_id_host_idx` ON `registry_credentials` (`project_id`,`host`);--> statement-breakpoint
CREATE INDEX `releases_project_id_idx` ON `releases` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `releases_project_id_number_idx` ON `releases` (`project_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `releases_project_id_tag_idx` ON `releases` (`project_id`,`tag`);--> statement-breakpoint
CREATE INDEX `releases_project_id_updated_at_idx` ON `releases` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `releases_project_id_default_since_idx` ON `releases` (`project_id`,`default_since`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_refresh_token_idx` ON `sessions` (`refresh_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `sigil_error_groups_sigil_id_fingerprint_idx` ON `sigil_error_groups` (`sigil_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `sigil_error_groups_sigil_id_last_seen_at_idx` ON `sigil_error_groups` (`sigil_id`,`last_seen_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sigil_uniques_daily_sigil_id_day_visitor_hash_traffic_idx` ON `sigil_uniques_daily` (`sigil_id`,`day`,`visitor_hash`,`traffic`);--> statement-breakpoint
CREATE INDEX `sigil_uniques_daily_sigil_id_day_idx` ON `sigil_uniques_daily` (`sigil_id`,`day`);--> statement-breakpoint
CREATE INDEX `sigils_project_id_idx` ON `sigils` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sigils_token_hash_idx` ON `sigils` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `sigils_project_id_name_idx` ON `sigils` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `sigils_created_by_idx` ON `sigils` (`created_by`);--> statement-breakpoint
CREATE INDEX `stack_deployments_environment_id_created_at_idx` ON `stack_deployments` (`environment_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stack_deployments_command_id_idx` ON `stack_deployments` (`command_id`);--> statement-breakpoint
CREATE INDEX `stack_deployments_project_id_idx` ON `stack_deployments` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stack_environment_routes_environment_id_domain_idx` ON `stack_environment_routes` (`environment_id`,`domain`);--> statement-breakpoint
CREATE UNIQUE INDEX `stack_environments_stack_id_env_idx` ON `stack_environments` (`stack_id`,`env`);--> statement-breakpoint
CREATE INDEX `stack_environments_estate_id_idx` ON `stack_environments` (`estate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stack_revisions_stack_id_number_idx` ON `stack_revisions` (`stack_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `stack_variables_environment_id_key_idx` ON `stack_variables` (`environment_id`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `stacks_project_id_name_idx` ON `stacks` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `stacks_estate_id_idx` ON `stacks` (`estate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_docks_user_id_idx` ON `user_docks` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_username_ci_idx` ON `users` (`realm`,"username" COLLATE NOCASE);--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_email_idx` ON `users` (`realm`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_phone_number_idx` ON `users` (`realm`,`phone_number`);--> statement-breakpoint
CREATE INDEX `verification_created_at_idx` ON `verification` (`created_at`);--> statement-breakpoint
CREATE INDEX `verification_target_code_idx` ON `verification` (`target`,`code`);