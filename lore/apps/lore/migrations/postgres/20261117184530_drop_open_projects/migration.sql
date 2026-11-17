-- alepha-allow-drop-table: a leaf with no child table, whose rows only blocked self-join, removed with public projects (#Q3833)
DROP TABLE "project_exclusions";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "join_policy";