import { type Infer, z } from "alepha";

/**
 * The `runningJobs` dashboard metric's filters: none.
 */
export const runningJobsFiltersSchema = z.object({});

export type RunningJobsFilters = Infer<typeof runningJobsFiltersSchema>;
