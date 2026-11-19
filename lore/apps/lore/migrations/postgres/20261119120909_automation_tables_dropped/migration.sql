ALTER TABLE "automation_receipts" DROP CONSTRAINT "automation_receipts_automation_id_automations_id_fkey";--> statement-breakpoint
ALTER TABLE "automation_runs" DROP CONSTRAINT "automation_runs_automation_id_automations_id_fkey";--> statement-breakpoint
-- alepha-allow-drop-table: #Q3902, the automation engine is deleted (#Q3896, deployed); children first, referenced by nothing else
DROP TABLE "automation_events";--> statement-breakpoint
-- alepha-allow-drop-table: #Q3902, the automation engine is deleted (#Q3896, deployed); children first, referenced by nothing else
DROP TABLE "automation_receipts";--> statement-breakpoint
-- alepha-allow-drop-table: #Q3902, the automation engine is deleted (#Q3896, deployed); children first, referenced by nothing else
DROP TABLE "automation_runs";--> statement-breakpoint
-- alepha-allow-drop-table: #Q3902, the automation engine is deleted (#Q3896, deployed); children first, referenced by nothing else
DROP TABLE "automation_variables";--> statement-breakpoint
-- alepha-allow-drop-table: #Q3902, the automation engine is deleted (#Q3896, deployed); children first, referenced by nothing else
DROP TABLE "automations";