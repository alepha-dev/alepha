-- Positions leave the graph (#Q3852, #E156): a rule stores no drawing, and
-- the node schema is strict, so a stored `position` would fail every read.
-- Rewritten in place: UPDATE only, no rebuild, no DROP. Safe to run twice:
-- a row without a position matches no WHERE. Node order is json_each's,
-- which is the array's. The outer json() keeps the aggregate a JSON value:
-- a scalar subquery drops its JSON subtype on some SQLite versions, and
-- json_set would then store the array as a string.
UPDATE `automations`
SET `rule` = json_set(`rule`, '$.nodes', json((
  SELECT json_group_array(json(json_remove(`node`.`value`, '$.position')))
  FROM json_each(`automations`.`rule`, '$.nodes') AS `node`
)))
WHERE EXISTS (
  SELECT 1 FROM json_each(`automations`.`rule`, '$.nodes') AS `node`
  WHERE json_type(`node`.`value`, '$.position') IS NOT NULL
);--> statement-breakpoint
-- A health record's snapshot holds the whole graph; a run's own subgraph
-- was already stored without positions.
UPDATE `automation_runs`
SET `snapshot` = json_set(`snapshot`, '$.rule.nodes', json((
  SELECT json_group_array(json(json_remove(`node`.`value`, '$.position')))
  FROM json_each(`automation_runs`.`snapshot`, '$.rule.nodes') AS `node`
)))
WHERE json_type(`snapshot`, '$.rule.nodes') = 'array'
  AND EXISTS (
    SELECT 1 FROM json_each(`automation_runs`.`snapshot`, '$.rule.nodes') AS `node`
    WHERE json_type(`node`.`value`, '$.position') IS NOT NULL
  );
