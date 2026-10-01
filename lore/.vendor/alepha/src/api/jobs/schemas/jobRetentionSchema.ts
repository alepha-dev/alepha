import { type Infer, z } from "alepha";

/**
 * The effective retention of a job, as the admin shows it.
 *
 * One rule per status: `ok` for successes, `error` for failures, which
 * cancelled rows follow. A rule is `false` when the status is not recorded
 * at all, or keeps a row while it is among the newest `last` and completed
 * within `days` (a row goes when it breaks either limit). `days` is already
 * evaluated here, so a rule read from a runtime parameter prints its current
 * value.
 *
 * `source` says whether each rule was declared by the job or is the
 * framework's default, and `cadence` is the bucket a cron's default was taken
 * from. Neither says anything about `jobConfig.retention.maxRows`, the cap
 * that bounds a default rule and practically never binds.
 */
export const jobRetentionSchema = z.object({
  ok: z.union([
    z.object({
      last: z.integer().optional(),
      days: z.number().optional(),
    }),
    z.literal(false),
  ]),
  error: z.union([
    z.object({
      last: z.integer().optional(),
      days: z.number().optional(),
    }),
    z.literal(false),
  ]),
  source: z.object({
    ok: z.enum(["job", "default"]),
    error: z.enum(["job", "default"]),
  }),
  cadence: z.enum(["frequent", "hourly", "daily", "slower"]).optional(),
});

export type JobRetention = Infer<typeof jobRetentionSchema>;
