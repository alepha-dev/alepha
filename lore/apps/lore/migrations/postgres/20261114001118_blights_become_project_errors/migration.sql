ALTER TABLE "blight_ignore_rules" RENAME TO "project_error_ignore_rules";--> statement-breakpoint
ALTER TABLE "blights" RENAME TO "project_errors";--> statement-breakpoint
ALTER INDEX "blight_ignore_rules_project_id_idx" RENAME TO "project_error_ignore_rules_project_id_idx";--> statement-breakpoint
ALTER INDEX "blights_project_id_fingerprint_idx" RENAME TO "project_errors_project_id_fingerprint_idx";--> statement-breakpoint
ALTER INDEX "blights_project_id_last_seen_at_idx" RENAME TO "project_errors_project_id_last_seen_at_idx";--> statement-breakpoint
ALTER TABLE "project_prompts" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
-- The customised Triage prompt, keyed by its kind (#E147, #Q3552): rewritten
-- while the column is text, before the new enum type casts it back.
UPDATE "project_prompts" SET "kind" = 'errorTriage' WHERE "kind" = 'blightTriage';--> statement-breakpoint
DROP TYPE "project_prompts_kind_enum";--> statement-breakpoint
CREATE TYPE "project_prompts_kind_enum" AS ENUM('epicReview', 'epicActivate', 'questWork', 'feedbackWork', 'feedbackLoop', 'errorTriage', 'questLoop', 'weeklyStatus');--> statement-breakpoint
ALTER TABLE "project_prompts" ALTER COLUMN "kind" SET DATA TYPE "project_prompts_kind_enum" USING "kind"::"project_prompts_kind_enum";--> statement-breakpoint
-- Blight becomes error (#E147, #Q3552). The two tables above are renamed in
-- place, rows kept. Below, every identifier a row stores is rewritten, so
-- nothing that worked before the deploy stops working after it.
--
-- Permissions, exact and wildcard, in ranks and API keys.
UPDATE "organization_ranks"
SET "permissions" = array_replace(array_replace(array_replace("permissions",
  'blight:read', 'error:read'),
  'blight:triage', 'error:triage'),
  'blight:*', 'error:*')
WHERE "permissions" && ARRAY['blight:read', 'blight:triage', 'blight:*']::text[];--> statement-breakpoint
UPDATE "api_keys"
SET "permissions" = array_replace(array_replace(array_replace("permissions",
  'blight:read', 'error:read'),
  'blight:triage', 'error:triage'),
  'blight:*', 'error:*')
WHERE "permissions" && ARRAY['blight:read', 'blight:triage', 'blight:*']::text[];--> statement-breakpoint
-- The open-errors metric, in dashboard cards and in automation rules (the
-- rule's `select.key`), and the preset a rule was made from.
UPDATE "dashboard_cards" SET "metric" = 'openErrors' WHERE "metric" = 'openBlights';--> statement-breakpoint
UPDATE "project_dashboard_cards" SET "metric" = 'openErrors' WHERE "metric" = 'openBlights';--> statement-breakpoint
UPDATE "automations"
SET "rule" = REPLACE("rule"::text, '"openBlights"', '"openErrors"')::jsonb
WHERE "rule"::text LIKE '%"openBlights"%';--> statement-breakpoint
UPDATE "automations" SET "preset_key" = 'error-crossing' WHERE "preset_key" = 'blight-crossing';--> statement-breakpoint
-- A sigil's kinds: `blights` is `errors`.
UPDATE "sigils"
SET "kinds" = array_replace("kinds", 'blights', 'errors')
WHERE 'blights' = ANY("kinds");--> statement-breakpoint
-- A forwarded quest names its error as `projectErrorId`: the hand-back reads
-- it, and a row missed here would stop a completed quest resolving its error.
UPDATE "quests"
SET "source" = ("source" - 'sigilBlightId')
  || jsonb_build_object('projectErrorId', "source" -> 'sigilBlightId')
WHERE "source" ? 'sigilBlightId';--> statement-breakpoint
-- The area the forward files into: `Blights` becomes `Errors`, merged into
-- an `Errors` area a project already has. The quests move first; areas are
-- hard-deleted and unique on (project_id, name).
UPDATE "quests" SET "area" = 'Errors' WHERE "area" = 'Blights';--> statement-breakpoint
DELETE FROM "areas"
WHERE "name" = 'Blights'
  AND "project_id" IN (SELECT "project_id" FROM "areas" WHERE "name" = 'Errors');--> statement-breakpoint
UPDATE "areas" SET "name" = 'Errors' WHERE "name" = 'Blights';
