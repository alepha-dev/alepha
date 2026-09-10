import { type Infer, z } from "alepha";

/**
 * The latest GitHub Actions run for a branch.
 */
export const ciRunSchema = z.object({
  id: z.integer(),
  /**
   * The workflow's name, `Verify` in this repository.
   */
  name: z.string(),
  /**
   * `queued`, `in_progress`, `completed`, or GitHub's rarer states.
   */
  status: z.string(),
  /**
   * `success`, `failure`, `cancelled`, `skipped`... once completed.
   */
  conclusion: z.string().optional(),
  url: z.string(),
  headSha: z.string(),
  startedAt: z.string(),
  updatedAt: z.string(),
  /**
   * 0 to 100 while the run is going: finished jobs, plus the finished share
   * of each running job's steps, over all jobs.
   */
  progress: z.number().optional(),
  jobs: z
    .object({
      total: z.integer(),
      completed: z.integer(),
      failed: z.integer(),
    })
    .optional(),
});

export type CiRun = Infer<typeof ciRunSchema>;
