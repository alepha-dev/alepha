-- An epic owns the draft of its quests (#Q4373, epic #E178): see the sqlite
-- migration of the same name.
UPDATE "quests"
SET "draft_at" = "created_at"
WHERE "draft_at" IS NULL
  AND "deleted_at" IS NULL
  AND "accepted_at" IS NULL
  AND "completed_at" IS NULL
  AND "epic_id" IN (
    SELECT "id" FROM "epics"
    WHERE "status" = 'draft' AND "deleted_at" IS NULL
  );
