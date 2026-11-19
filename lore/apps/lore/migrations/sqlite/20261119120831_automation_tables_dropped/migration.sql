DROP INDEX IF EXISTS `automation_events_project_id_identity_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automation_events_dispatched_at_attempts_created_at_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automation_events_replay_until_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automation_receipts_rule_state_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automation_receipts_project_id_identity_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automation_receipts_running_rule`;--> statement-breakpoint
DROP INDEX IF EXISTS `automation_receipts_kind_status_lease_until_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automation_receipts_parent_id_kind_position_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automation_receipts_kind_status_queue_attempts_created_at_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automation_receipts_project_id_kind_created_at_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automation_receipts_replay_until_status_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automation_runs_automation_id_created_at_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automation_runs_project_id_created_at_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automation_runs_finished_at_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automation_variables_project_id_key_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automations_enabled_health_next_run_at_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automations_project_id_author_user_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automations_health_checked_at_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automations_author_user_id_idx`;--> statement-breakpoint
-- alepha-allow-drop-table: #Q3902, the automation engine is deleted (#Q3896, deployed); children first, referenced by nothing else
DROP TABLE `automation_events`;--> statement-breakpoint
-- alepha-allow-drop-table: #Q3902, the automation engine is deleted (#Q3896, deployed); children first, referenced by nothing else
DROP TABLE `automation_receipts`;--> statement-breakpoint
-- alepha-allow-drop-table: #Q3902, the automation engine is deleted (#Q3896, deployed); children first, referenced by nothing else
DROP TABLE `automation_runs`;--> statement-breakpoint
-- alepha-allow-drop-table: #Q3902, the automation engine is deleted (#Q3896, deployed); children first, referenced by nothing else
DROP TABLE `automation_variables`;--> statement-breakpoint
-- alepha-allow-drop-table: #Q3902, the automation engine is deleted (#Q3896, deployed); children first, referenced by nothing else
DROP TABLE `automations`;