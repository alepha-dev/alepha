-- A quest's status is todo | in_progress | on_hold | shelved | completed,
-- where it was new | accepted | held | shelved | completed (#Q2269).
-- Decision note: Lore folio #F1290.
--
-- A quest's status is derived from its timestamps and never stored, so no
-- quest row changes. Two JSON columns do store the values, and both are
-- validated on READ, so they are rewritten in the same deploy:
--
-- 1. `projects.kanban_column_config`, `{ "<column name>": { "status": ... } }`.
--    ⚠️ It is on the projects row: a value the enum no longer knows fails to
--    decode and takes every project read with it (the 2026-08-05 shape, see
--    apps/lore/CLAUDE.md, "Renaming a REQUIRED key inside a JSON column").
-- 2. The Active quests card's `statuses` filter, in `project_dashboard_cards`
--    and `dashboard_cards`. A stale value degrades to the metric's defaults
--    there rather than failing, which would silently drop the owner's
--    choice, so it is rewritten too. Only `metric = 'activeQuests'` is
--    touched: other metrics store feedback's own `accepted`.
--
-- `quests.history` keeps its action names (`assigned`, `held`, ...): they
-- are events, not statuses. `json(...)` around each rewritten value is
-- load-bearing: without it the value is embedded as a JSON string rather
-- than as the object or array it is.

UPDATE `projects`
SET `kanban_column_config` = (
  SELECT json_group_object(
    `c`.`key`,
    json(CASE json_extract(`c`.`value`, '$.status')
      WHEN 'new' THEN json_set(`c`.`value`, '$.status', 'todo')
      WHEN 'accepted' THEN json_set(`c`.`value`, '$.status', 'in_progress')
      ELSE `c`.`value`
    END)
  )
  FROM json_each(`projects`.`kanban_column_config`) AS `c`
)
WHERE `kanban_column_config` IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM json_each(`projects`.`kanban_column_config`) AS `c`
    WHERE json_extract(`c`.`value`, '$.status') IN ('new', 'accepted')
  );--> statement-breakpoint
UPDATE `project_dashboard_cards`
SET `filters` = json_set(`filters`, '$.statuses', json((
  SELECT json_group_array(
    CASE `s`.`value`
      WHEN 'new' THEN 'todo'
      WHEN 'accepted' THEN 'in_progress'
      ELSE `s`.`value`
    END
  )
  FROM json_each(`project_dashboard_cards`.`filters`, '$.statuses') AS `s`
)))
WHERE `metric` = 'activeQuests'
  AND json_type(`filters`, '$.statuses') = 'array';--> statement-breakpoint
UPDATE `dashboard_cards`
SET `filters` = json_set(`filters`, '$.statuses', json((
  SELECT json_group_array(
    CASE `s`.`value`
      WHEN 'new' THEN 'todo'
      WHEN 'accepted' THEN 'in_progress'
      ELSE `s`.`value`
    END
  )
  FROM json_each(`dashboard_cards`.`filters`, '$.statuses') AS `s`
)))
WHERE `metric` = 'activeQuests'
  AND json_type(`filters`, '$.statuses') = 'array';
