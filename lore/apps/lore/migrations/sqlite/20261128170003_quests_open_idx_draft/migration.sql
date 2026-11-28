-- The open-quests partial index follows the draft status (#Q4374, epic #E178).
-- The backlog gate filtered on `epic_id`, which is why the index named it; the
-- open count now filters on `draft_at IS NULL` instead, an equality the planner
-- binds, so the column joins the other null columns in the column list AND the
-- `WHERE` (see `quests_open_idx` on the `quests` entity). Drop and recreate one
-- index: no table is rebuilt and no row is written.
DROP INDEX IF EXISTS `quests_open_idx`;--> statement-breakpoint
CREATE INDEX `quests_open_idx` ON `quests` (`project_id`,`deleted_at`,`completed_at`,`shelved_at`,`draft_at`) WHERE ((("quests"."deleted_at" is null)) and (("quests"."completed_at" is null)) and (("quests"."shelved_at" is null)) and (("quests"."draft_at" is null)));
