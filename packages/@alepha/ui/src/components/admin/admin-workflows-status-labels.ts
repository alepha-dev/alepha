import { useI18n } from "alepha/react/i18n";

/**
 * The workflow-execution vocabulary, in the order the filter offers it.
 *
 * `skipped` is deliberately absent: it is a STEP status only, so offering it
 * as an execution filter would be a value the query can never match. The
 * labels below still carry it, because the badge renders step rows too.
 */
export const WORKFLOW_EXECUTION_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "timed_out",
  "compensating",
  "compensated",
  "compensation_failed",
  "cancelled",
];

/**
 * Localised workflow status labels, keyed by status.
 *
 * Covers both vocabularies — `workflowExecutions` and `workflowStepExecutions`
 * differ only on `timed_out` / `skipped` — because the badge takes either.
 *
 * One literal `tr()` per status: see {@link useJobStatusLabels} for why a
 * computed key could never have been translated.
 */
export const useWorkflowStatusLabels = (): Record<string, string> => {
  const { tr } = useI18n();
  return {
    pending: tr("admin.workflows.status.pending", { default: "Pending" }),
    running: tr("admin.workflows.status.running", { default: "Running" }),
    completed: tr("admin.workflows.status.completed", { default: "Completed" }),
    failed: tr("admin.workflows.status.failed", { default: "Failed" }),
    timed_out: tr("admin.workflows.status.timedOut", { default: "Timed out" }),
    skipped: tr("admin.workflows.status.skipped", { default: "Skipped" }),
    compensating: tr("admin.workflows.status.compensating", {
      default: "Compensating",
    }),
    compensated: tr("admin.workflows.status.compensated", {
      default: "Compensated",
    }),
    compensation_failed: tr("admin.workflows.status.compensationFailed", {
      default: "Compensation failed",
    }),
    cancelled: tr("admin.workflows.status.cancelled", { default: "Cancelled" }),
  };
};
