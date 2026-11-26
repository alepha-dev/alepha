import { type Infer, z } from "alepha";

/**
 * A job's log, or the part of it past the byte counts the caller already
 * holds (#Q3984): the page polls with `next` while the job runs.
 */
export const hostJobLogSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  next: z.object({ stdout: z.integer(), stderr: z.integer() }),
  /**
   * Where the stdout text starts, in bytes: set on a `tail` read (#Q4514),
   * whose text may begin inside a line.
   */
  start: z.integer().optional(),
  /** Whether more may come: the job has not ended. */
  live: z.boolean(),
});

export type HostJobLogResource = Infer<typeof hostJobLogSchema>;
