-- #E74 / #Q2604: the six frozen leaf tables, dropped.
--
-- Checked on the previous snapshot (20260929135124_folio_version): no foreign
-- key points at any of them, so no DROP here can cascade or detach a row, and
-- `migration-safety.spec.ts` refuses this migration if that ever stops being
-- true. None is read or written by the code that ships with it.
--   members, invitations, rank_definitions: replaced by alepha/api/organizations.
--   sigil_views_hourly, sigil_vitals_hourly: replaced by the $analytics datasets.
--   analytics_backfills: the guard of the one-shot ActivityBackfillJob, deleted
--     in the same change. Its row was confirmed on production first (the
--     2026-10-04 rehearsal counted 1), so the backfill has run and must not
--     run again: Analytics Engine has no delete.
DROP INDEX IF EXISTS `invitations_email_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `invitations_resource_type_resource_id_email_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `invitations_invited_by_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `invitations_expires_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `members_user_id_project_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `rank_definitions_type_scope_id_key_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `rank_definitions_type_scope_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `sigil_views_hourly_sigil_id_hour_path_country_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `sigil_views_hourly_sigil_id_hour_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `sigil_vitals_hourly_sigil_id_hour_metric_path_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `sigil_vitals_hourly_sigil_id_hour_idx`;--> statement-breakpoint
-- alepha-allow-drop-table: leaf, nothing references it
DROP TABLE `analytics_backfills`;--> statement-breakpoint
-- alepha-allow-drop-table: leaf, nothing references it
DROP TABLE `invitations`;--> statement-breakpoint
-- alepha-allow-drop-table: leaf, nothing references it
DROP TABLE `members`;--> statement-breakpoint
-- alepha-allow-drop-table: leaf, nothing references it
DROP TABLE `rank_definitions`;--> statement-breakpoint
-- alepha-allow-drop-table: leaf, nothing references it
DROP TABLE `sigil_views_hourly`;--> statement-breakpoint
-- alepha-allow-drop-table: leaf, nothing references it
DROP TABLE `sigil_vitals_hourly`;