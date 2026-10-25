-- A copy's Cloudflare name is stored at its first deploy (#Q2473), so a
-- project rename no longer moves the prefix every deploy recomputed.
--
-- ⚠️ Purely additive: one nullable column, no DEFAULT, no foreign key, so
-- SQLite adds it in place. `app_instances` is the `ON DELETE CASCADE` parent of
-- `app_secrets` and `deployments`, and a rebuild here would be the D1 cascade
-- wipe documented in `apps/lore/CLAUDE.md`. There is no DROP TABLE below.

ALTER TABLE `app_instances` ADD `resource_name` text;--> statement-breakpoint
-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- A copy that has deployed recorded its Worker name in `resources`, and that
-- name IS the prefix its database and bucket were created under. Copying it
-- keeps every live copy on the resources it already has, whatever its project
-- is called today. A copy with no recorded Worker (never deployed, or
-- destroyed) takes its name from the current slug at its next deploy.
UPDATE `app_instances`
SET `resource_name` = json_extract(`resources`, '$.worker')
WHERE `resource_name` IS NULL
  AND json_valid(`resources`)
  AND json_extract(`resources`, '$.worker') IS NOT NULL;
