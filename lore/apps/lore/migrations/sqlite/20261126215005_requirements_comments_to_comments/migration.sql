-- Persona and use case comments move to core's `comments` (#Q4519, #E185):
-- a copy, the subject kind (`persona`, `usecase`) as the subject type.
--
-- A data migration, written by hand: no table changes shape here.
-- `requirements_comments` is left untouched on purpose, by the owner's
-- decision (review of #E185, item 26): nothing reads it any more, and one
-- later migration removes it with `quest_comments` and `feedback_comments`
-- once the counts are compared on production.
--
-- The two columns that said a machine wrote a comment become the one
-- `source`: `by_agent` is `kind: "mcp"`, `agent_client` is `client`, left
-- out when the agent gave no name. Ids are not kept; the rows are copied in
-- id order.
INSERT INTO `comments` (`created_at`, `updated_at`, `project_id`, `subject_type`, `subject_id`, `author_id`, `body`, `source`)
SELECT c.`created_at`, c.`updated_at`, c.`project_id`, c.`subject_kind`, c.`subject_id`, c.`author_id`, c.`body`,
  CASE
    WHEN c.`by_agent` = 1 AND c.`agent_client` IS NOT NULL THEN json_object('kind', 'mcp', 'client', c.`agent_client`)
    WHEN c.`by_agent` = 1 THEN json_object('kind', 'mcp')
    ELSE NULL
  END
FROM `requirements_comments` c
ORDER BY c.`id`;
