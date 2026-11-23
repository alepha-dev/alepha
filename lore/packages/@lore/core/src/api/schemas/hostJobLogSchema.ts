import { type Infer, z } from "alepha";

/**
 * A job's log, or the part of it past the byte counts the caller already
 * holds (#Q3984): the page polls with `next` while the job runs.
 */
export const hostJobLogSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  next: z.object({ stdout: z.integer(), stderr: z.integer() }),
  /** Whether more may come: the job has not ended. */
  live: z.boolean(),
});

export type HostJobLogResource = Infer<typeof hostJobLogSchema>;
