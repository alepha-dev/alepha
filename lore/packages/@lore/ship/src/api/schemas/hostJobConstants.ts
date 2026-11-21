/*
 * The job vocabulary is core's (the `HostJobs` port); re-exported so Ship's
 * entity and pages import it from one place.
 */
export {
  HOST_JOB_KINDS,
  HOST_JOB_STATUSES,
  HOST_JOB_TERMINAL,
} from "@lore/core/schemas";
export type { HostJobKind, HostJobStatus } from "@lore/core/schemas";
