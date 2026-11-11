import { type Infer, z } from "alepha";

/**
 * Execution figures for the admin's Jobs page banner (#Q3431), over a recent
 * window. `ok`, `error` and `cancelled` count runs that finished inside the
 * window and are still kept: retention trims successful runs hardest, so the
 * figures are a floor, never a total. `running` and `waiting` are now.
 */
export const jobStatsSchema = z.object({
  windowHours: z.integer(),
  ok: z.integer(),
  error: z.integer(),
  cancelled: z.integer(),
  running: z.integer(),
  waiting: z.integer(),
  lastError: z
    .object({
      jobName: z.text(),
      completedAt: z.datetime(),
    })
    .optional(),
});

export type JobStats = Infer<typeof jobStatsSchema>;
