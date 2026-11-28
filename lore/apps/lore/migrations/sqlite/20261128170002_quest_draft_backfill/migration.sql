-- An epic owns the draft of its quests (#Q4373, epic #E178). Until now a
-- draft epic's quests stayed `todo` and a read filter hid them; from here
-- they carry `draft_at`. Every quest of a draft epic that nobody has taken or
-- finished becomes a draft, as of its creation: no `accepted_at` and no
-- `completed_at`, its shelved and held ones included, since they read
-- `shelved` or `on_hold` and read `draft` again once they come back.
-- Soft-deleted quests and epics are left as they are. One UPDATE, no rebuild.
UPDATE `quests`
SET `draft_at` = `created_at`
WHERE `draft_at` IS NULL
  AND `deleted_at` IS NULL
  AND `accepted_at` IS NULL
  AND `completed_at` IS NULL
  AND `epic_id` IN (
    SELECT `id` FROM `epics`
    WHERE `status` = 'draft' AND `deleted_at` IS NULL
  );
