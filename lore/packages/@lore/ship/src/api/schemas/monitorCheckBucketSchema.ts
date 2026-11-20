import { type Infer, z } from "alepha";

/**
 * One slice of the Uptime page's check bar (#Q4009): the checks that ran in
 * `[from, to)`, and how many of them failed. `checks: 0` is a slice where
 * nothing ran, drawn empty rather than green.
 */
export const monitorCheckBucketSchema = z.object({
  from: z.string(),
  to: z.string(),
  checks: z.integer().min(0),
  failures: z.integer().min(0),
});

export type MonitorCheckBucket = Infer<typeof monitorCheckBucketSchema>;
