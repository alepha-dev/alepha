-- #Q3628: adoption is gone. An adopted rule stays an ordinary rule: its
-- `compatibility` key is stripped from the rule and from the snapshots of its
-- runs and occurrences, and the rule keeps running.
UPDATE "automations" SET "rule" = "rule" - 'compatibility'
WHERE "rule" ? 'compatibility';--> statement-breakpoint
UPDATE "automation_runs" SET "snapshot" = "snapshot" #- '{rule,compatibility}'
WHERE "snapshot" -> 'rule' ? 'compatibility';--> statement-breakpoint
UPDATE "automation_receipts" SET "snapshot" = "snapshot" #- '{rule,compatibility}'
WHERE "snapshot" IS NOT NULL AND "snapshot" -> 'rule' ? 'compatibility';--> statement-breakpoint
-- alepha-allow-drop-table: #Q3628, adoption is gone and nothing references this leaf table
DROP TABLE "automation_adoptions";--> statement-breakpoint
DROP TYPE "automation_adoptions_policy_enum";--> statement-breakpoint
DROP TYPE "automation_adoptions_state_enum";