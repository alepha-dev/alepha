-- #Q3628: adoption is gone. An adopted rule stays an ordinary rule: its
-- `compatibility` key is stripped from the rule and from the snapshots of its
-- runs and occurrences, and the rule keeps running.
UPDATE `automations` SET `rule` = json_remove(`rule`, '$.compatibility')
WHERE json_type(`rule`, '$.compatibility') IS NOT NULL;--> statement-breakpoint
UPDATE `automation_runs` SET `snapshot` = json_remove(`snapshot`, '$.rule.compatibility')
WHERE json_type(`snapshot`, '$.rule.compatibility') IS NOT NULL;--> statement-breakpoint
UPDATE `automation_receipts` SET `snapshot` = json_remove(`snapshot`, '$.rule.compatibility')
WHERE `snapshot` IS NOT NULL AND json_type(`snapshot`, '$.rule.compatibility') IS NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `automation_adoptions_project_id_policy_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `automation_adoptions_automation_id_idx`;--> statement-breakpoint
-- alepha-allow-drop-table: #Q3628, adoption is gone and nothing references this leaf table
DROP TABLE `automation_adoptions`;