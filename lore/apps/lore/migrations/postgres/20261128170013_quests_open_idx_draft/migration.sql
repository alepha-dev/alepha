-- The open-quests partial index follows the draft status (#Q4374, epic #E178).
-- The backlog gate filtered on `epic_id`, which is why the index named it; the
-- open count now filters on `draft_at IS NULL`, so the column joins the other
-- null columns in the column list and the `WHERE`. Drop and recreate one index:
-- no table is rebuilt and no row is written.
DROP INDEX "quests_open_idx";--> statement-breakpoint
CREATE INDEX "quests_open_idx" ON "quests" ("project_id","deleted_at","completed_at","shelved_at","draft_at") WHERE ((("deleted_at" is null)) and (("completed_at" is null)) and (("shelved_at" is null)) and (("draft_at" is null)));