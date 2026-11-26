-- Feedback comments move to core's "comments" (#Q4518, #E185): a copy, every
-- row with its project (through its item), under the subject 'feedback'.
--
-- A data migration, written by hand: no table changes shape here.
-- "feedback_comments" is left untouched on purpose, by the owner's decision
-- (review of #E185, item 26): nothing reads it any more, and one later
-- migration removes it with "quest_comments" and "requirements_comments"
-- once the counts are compared on production.
--
-- "attachments" defaulted to an empty array there and is optional here: an
-- empty array is copied as NULL, which is what a comment without a file
-- holds in "comments". Ids are not kept; the rows are copied in id order.
INSERT INTO "comments" ("created_at", "updated_at", "project_id", "subject_type", "subject_id", "author_id", "body", "edited_at", "attachments", "source")
SELECT c."created_at", c."updated_at", f."project_id", 'feedback', c."feedback_id", c."author_id", c."body", c."edited_at", NULLIF(c."attachments", '{}'::text[]), c."source"
FROM "feedback_comments" c
JOIN "feedback" f ON f."id" = c."feedback_id"
ORDER BY c."id";
