-- Positions leave the graph (#Q3852, #E156): a rule stores no drawing, and
-- the node schema is strict, so a stored `position` would fail every read.
-- Rewritten in place: UPDATE only, no rebuild, no DROP. Safe to run twice:
-- a row without a position matches no WHERE. Node order is kept by the
-- array's ordinality.
UPDATE "automations"
SET "rule" = jsonb_set("rule", '{nodes}', (
  SELECT jsonb_agg("item"."node" - 'position' ORDER BY "item"."index")
  FROM jsonb_array_elements("automations"."rule" -> 'nodes')
    WITH ORDINALITY AS "item"("node", "index")
))
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements("automations"."rule" -> 'nodes') AS "item"("node")
  WHERE ("item"."node" -> 'position') IS NOT NULL
);--> statement-breakpoint
-- A health record's snapshot holds the whole graph; a run's own subgraph
-- was already stored without positions.
UPDATE "automation_runs"
SET "snapshot" = jsonb_set("snapshot", '{rule,nodes}', (
  SELECT jsonb_agg("item"."node" - 'position' ORDER BY "item"."index")
  FROM jsonb_array_elements("automation_runs"."snapshot" -> 'rule' -> 'nodes')
    WITH ORDINALITY AS "item"("node", "index")
))
WHERE jsonb_typeof("snapshot" -> 'rule' -> 'nodes') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements("automation_runs"."snapshot" -> 'rule' -> 'nodes') AS "item"("node")
    WHERE ("item"."node" -> 'position') IS NOT NULL
  );
