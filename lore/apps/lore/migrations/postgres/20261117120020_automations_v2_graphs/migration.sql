-- Automations v2 (#E155, #Q3805): a rule is a graph now, and v1 rules are
-- dropped, not migrated (the owner's decision, pre-v1). Children first:
-- receipts and runs reference automations with RESTRICT. Channels and
-- shared variables are kept; dispatched events too, for Run test's history.
DELETE FROM "automation_receipts";--> statement-breakpoint
DELETE FROM "automation_runs";--> statement-breakpoint
DELETE FROM "automations";--> statement-breakpoint
DELETE FROM "automation_events" WHERE "dispatched_at" IS NULL;--> statement-breakpoint
ALTER TABLE "automation_receipts" DROP COLUMN "action_index";
