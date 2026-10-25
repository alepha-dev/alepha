-- Zone -> Area (de-RPG pass).
--
-- Two pure RENAME COLUMNs: no rebuild, no DROP, and every existing value
-- carries over untouched. That is the whole reason `--hints` was passed —
-- without a rename hint drizzle-kit emits CREATE + DROP, which on this data
-- means every quest silently loses its area.
--
-- Guarded by `migration-safety.spec.ts`, which seeds real values before this
-- migration and asserts they are still there after it.
ALTER TABLE `projects` RENAME COLUMN `zones` TO `areas`;--> statement-breakpoint
ALTER TABLE `quests` RENAME COLUMN `zone` TO `area`;