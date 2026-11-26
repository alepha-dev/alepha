import { type Infer, z } from "alepha";

/**
 * An agent run on an error, as its thread shows it (#Q4471): one that has
 * not answered. A run that ended well shows nothing here: its comment, and
 * its forward when it made one, are entries of the thread.
 */
export const projectErrorThreadJobSchema = z.object({
  id: z.uuid(),
  status: z.enum(["queued", "running", "failed", "timed_out"]),
  /**
   * The prompt it runs, by name.
   */
  prompt: z.string().optional(),
  queuedAt: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
});

export type ProjectErrorThreadJob = Infer<typeof projectErrorThreadJobSchema>;
