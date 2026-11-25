DROP INDEX IF EXISTS `project_prompts_project_id_kind_idx`;--> statement-breakpoint
-- alepha-allow-drop-table: #Q4281, a project keeps no copy of a prompt any more (the built-ins are the server's, #Q4274); a leaf, referenced by nothing
DROP TABLE `project_prompts`;