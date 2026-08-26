import type { JobExecutionResource } from "alepha/api/jobs";
import { useI18n } from "alepha/react/i18n";

export type JobExecutionStatus = JobExecutionResource["status"];

/**
 * The job-execution vocabulary, in the order the filter offers it.
 *
 * `jobExecutionEntity`'s enum, restated: the panel and the badge both need
 * the set, and a second hand-kept copy in each of them is how one of them
 * ends up missing a status.
 */
export const JOB_EXECUTION_STATUSES: JobExecutionStatus[] = [
  "pending",
  "running",
  "scheduled",
  "ok",
  "error",
  "cancelled",
];

/**
 * Localised job-execution status labels, keyed by status.
 *
 * One literal `tr()` per status, rather than the
 * `tr(\`admin.jobs.status.${status}\`)` this replaces. A computed key is
 * invisible to `i18n-fr.spec.ts`, which finds keys by matching a literal
 * after `tr(` - so the French entries could not be added at all: the spec
 * would have reported every one of them as a translation nothing asks for.
 * The statuses rendered raw in French as a result (`ok`, `error`,
 * `cancelled`), which reads as a bug rather than as a missing translation.
 *
 * A record rather than a function, because both callers want the whole set:
 * the filter lists it, and the badge indexes it.
 */
export const useJobStatusLabels = (): Record<JobExecutionStatus, string> => {
  const { tr } = useI18n();
  return {
    pending: tr("admin.jobs.status.pending", { default: "Pending" }),
    running: tr("admin.jobs.status.running", { default: "Running" }),
    scheduled: tr("admin.jobs.status.scheduled", { default: "Scheduled" }),
    ok: tr("admin.jobs.status.ok", { default: "Succeeded" }),
    error: tr("admin.jobs.status.error", { default: "Failed" }),
    cancelled: tr("admin.jobs.status.cancelled", { default: "Cancelled" }),
  };
};
