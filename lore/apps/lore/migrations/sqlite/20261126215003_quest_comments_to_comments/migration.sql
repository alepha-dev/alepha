-- Quest comments move to core's `comments` (#Q4517, #E185): a copy, every
-- row with its project (through its quest), under the subject `quest`.
--
-- A data migration, written by hand: no table changes shape here.
-- `quest_comments` is left untouched on purpose, by the owner's decision
-- (review of #E185, item 26): nothing reads it any more, and one later
-- migration removes it with `feedback_comments` and `requirements_comments`
-- once the counts are compared on production.
--
-- Ids are not kept: nothing outside an audit row's metadata holds one. The
-- rows are copied in id order, so the new ids ascend as the old ones did.
INSERT INTO `comments` (`created_at`, `updated_at`, `project_id`, `subject_type`, `subject_id`, `author_id`, `body`, `edited_at`, `attachments`, `source`)
SELECT c.`created_at`, c.`updated_at`, q.`project_id`, 'quest', c.`quest_id`, c.`author_id`, c.`body`, c.`edited_at`, c.`attachments`, c.`source`
FROM `quest_comments` c
JOIN `quests` q ON q.`id` = c.`quest_id`
ORDER BY c.`id`;
