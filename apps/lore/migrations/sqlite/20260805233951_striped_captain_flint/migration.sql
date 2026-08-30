-- Drop the outpost / artifact / deployment tables.
--
-- These are the server half of the abandoned Bay<->Lore control plane. Bay is
-- now reached only over SSH, so nothing reads or writes any of them; their code
-- was removed in the preceding commit.
--
-- HAND-EDITED: the DROP TABLE order below is NOT drizzle-kit's. It emitted
--   artifacts, deployments, outpost_apps, outpost_events, outposts
-- which drops `artifacts` while `deployments` still holds a foreign key into
-- it. Reordered child-before-parent. The four inbound foreign keys are:
--   deployments    -> artifacts  (SET NULL)
--   deployments    -> outposts   (SET NULL)
--   outpost_apps   -> outposts   (CASCADE)
--   outpost_events -> outposts   (CASCADE)
--
-- Honest scope of that reorder: it is defensive, NOT load-bearing. Both orders
-- were executed against a seeded database with foreign_keys=ON and both
-- preserved every row of all 31 retained tables. Drizzle's order is survivable
-- because the two FKs into `artifacts`/`outposts` from `deployments` are SET
-- NULL rather than CASCADE, and the two tables that DO cascade from `outposts`
-- (`outpost_apps`, `outpost_events`) already precede it in drizzle's order too.
-- The reorder is kept because child-before-parent is the rule this repo follows
-- for drops, and it costs nothing — not because it averted a wipe here.
--
-- D1 CASCADE SAFETY (see CLAUDE.md "Migration safety on D1"): checked against
-- the previous snapshot's 45 foreign keys — ZERO retained tables reference any
-- of these five. Every inbound FK listed above comes from a table that is
-- itself dropped here, and by the time each parent drops, its children are
-- already gone. The outbound FKs (artifacts/outposts/deployments -> projects,
-- -> users) point child-to-parent, and dropping a child never touches its
-- parent. No table is rebuilt: there is no CREATE, no INSERT ... SELECT and no
-- RENAME in this file, so the drizzle rebuild pattern that cascade-wiped
-- production in 2026-05 is not in play here.
DROP INDEX IF EXISTS `artifacts_project_id_app_tag_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `artifacts_project_id_sha256_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `deployments_project_id_app_environment_version_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `deployments_project_id_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `deployments_outpost_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `outpost_apps_outpost_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `outpost_apps_outpost_id_app_environment_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `outpost_apps_app_environment_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `outpost_events_outpost_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `outpost_events_app_environment_occurred_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `outpost_events_outpost_id_app_environment_kind_occurred_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `outposts_project_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `outposts_token_hash_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `outposts_created_by_idx`;--> statement-breakpoint
-- alepha-allow-drop-table: abandoned control plane, child of `outposts` (see header)
DROP TABLE `outpost_events`;--> statement-breakpoint
-- alepha-allow-drop-table: abandoned control plane, child of `outposts` (see header)
DROP TABLE `outpost_apps`;--> statement-breakpoint
-- alepha-allow-drop-table: abandoned control plane, parent of nothing (see header)
DROP TABLE `deployments`;--> statement-breakpoint
-- alepha-allow-drop-table: abandoned control plane, its only child is
-- `deployments`, dropped above, and that FK was SET NULL (see header)
DROP TABLE `artifacts`;--> statement-breakpoint
-- alepha-allow-drop-table: abandoned control plane, all four inbound FKs are
-- from the tables dropped above (see header)
DROP TABLE `outposts`;
