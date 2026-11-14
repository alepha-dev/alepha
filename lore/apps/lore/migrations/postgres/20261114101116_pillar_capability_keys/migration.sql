-- Lore's three pillars (#E143, #Q3501): the capability keys `work`,
-- `knowledge` and `apps` become `plan`, `remember` and `ship`. A capability key
-- is a text column, not a key inside JSON, so one UPDATE moves it; option keys
-- inside `options` do not move (`work.board` is `plan.board`). `support` is
-- left for #Q3502. No row holds a new key yet, so the unique
-- (project_id, key) index cannot collide.
UPDATE "project_capabilities"
SET "key" = CASE "key"
  WHEN 'work' THEN 'plan'
  WHEN 'knowledge' THEN 'remember'
  WHEN 'apps' THEN 'ship'
END
WHERE "key" IN ('work', 'knowledge', 'apps');
--> statement-breakpoint
-- The audit rows `ProjectCapabilityController` writes name the capability in
-- `metadata.capability`: rewritten too, so the activity feed labels an old
-- event with the capability as it is called now.
UPDATE "audits"
SET "metadata" = jsonb_set(
  "metadata",
  '{capability}',
  to_jsonb(CASE "metadata" ->> 'capability'
    WHEN 'work' THEN 'plan'
    WHEN 'knowledge' THEN 'remember'
    WHEN 'apps' THEN 'ship'
  END)
)
WHERE "action" = 'capability'
  AND "metadata" ->> 'capability' IN ('work', 'knowledge', 'apps');
