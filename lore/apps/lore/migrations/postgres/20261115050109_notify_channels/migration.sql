-- #Q3613: a stored rule's notify names `channels`, a list, instead of one
-- `channel`. Rewrites every stored rule's notify actions in place, order
-- kept; run snapshots keep `channel`, the form a run executes.
UPDATE "automations"
SET "rule" = jsonb_set("rule", '{actions}', (
  SELECT jsonb_agg(
    CASE
      WHEN "a"."value" ->> 'kind' = 'notify' AND "a"."value" ? 'channel'
      THEN ("a"."value" - 'channel')
        || jsonb_build_object('channels', jsonb_build_array("a"."value" -> 'channel'))
      ELSE "a"."value"
    END
    ORDER BY "a"."ordinality"
  )
  FROM jsonb_array_elements("automations"."rule" -> 'actions')
    WITH ORDINALITY AS "a"("value", "ordinality")
))
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements("automations"."rule" -> 'actions') AS "a"("value")
  WHERE "a"."value" ->> 'kind' = 'notify' AND "a"."value" ? 'channel'
);
