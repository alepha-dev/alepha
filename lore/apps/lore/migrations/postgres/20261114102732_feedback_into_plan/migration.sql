-- Support folds into Plan (#E143, #Q3502): Lore has three capabilities, and
-- feedback (the request form, the triage inbox) is the option
-- `plan.feedback`. Only the switch moves: no feedback item, comment or
-- attachment is touched.
--
-- A project with Support and Plan: `feedback` is turned on in its Plan row,
-- every other option kept.
UPDATE "project_capabilities"
SET "options" = jsonb_set("options", '{feedback}', 'true'::jsonb, true)
WHERE "key" = 'plan'
  AND "project_id" IN (
    SELECT "project_id" FROM "project_capabilities" WHERE "key" = 'support'
  );
--> statement-breakpoint
-- A project with Support and no Plan (owner, 2026-11-12): Plan is turned on
-- with `feedback` and every other option off, an absent key reading as off.
-- It keeps the moment Support was turned on.
INSERT INTO "project_capabilities" ("project_id", "key", "enabled_at", "options")
SELECT "project_id", 'plan', "enabled_at", '{"feedback":true}'::jsonb
FROM "project_capabilities" AS "support"
WHERE "support"."key" = 'support'
  AND NOT EXISTS (
    SELECT 1 FROM "project_capabilities" AS "plan"
    WHERE "plan"."project_id" = "support"."project_id" AND "plan"."key" = 'plan'
  );
--> statement-breakpoint
-- No row is kept for a disabled capability, so every Support row is an
-- enabled one, and folded above.
DELETE FROM "project_capabilities" WHERE "key" = 'support';
--> statement-breakpoint
-- The audit rows that turned Support on or off read as the Feedback option
-- being turned on or off.
UPDATE "audits"
SET "metadata" = "metadata" || '{"capability":"plan","option":"feedback"}'::jsonb
WHERE "action" = 'capability'
  AND "metadata" ->> 'capability' = 'support';
