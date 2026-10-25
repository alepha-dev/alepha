DROP INDEX IF EXISTS `workflow_executions_workflow_name_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `workflow_executions_workflow_name_status_created_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `workflow_executions_workflow_name_key_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `workflow_executions_status_deadline_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `workflow_executions_completed_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `workflow_step_executions_workflow_execution_id_step_name_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `workflow_step_executions_workflow_execution_id_step_index_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `workflow_step_executions_workflow_execution_id_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `workflow_step_executions_status_scheduled_at_idx`;--> statement-breakpoint
-- alepha-allow-drop-table: the workflow engine is removed (epic #33). The three
-- workflow tables go together, leaf first; nothing outside them references them,
-- and their history (per-step logs) has no replacement by decision. On the
-- deployed D1 this is the only data lost: finished settlement and cart recovery
-- executions, which the jobs table records from now on.
DROP TABLE `workflow_step_logs`;--> statement-breakpoint
-- alepha-allow-drop-table: same removal; step executions reference executions
-- and are dropped before their parent.
DROP TABLE `workflow_step_executions`;--> statement-breakpoint
-- alepha-allow-drop-table: same removal; the last of the three, once nothing
-- references it any more.
DROP TABLE `workflow_executions`;
