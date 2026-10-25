import { type Infer, z } from "alepha";

/**
 * One quality run as the API returns it.
 *
 * The four percentages and the four counts, flat, because that is what the
 * Reports tab renders and what its graphs plot.
 *
 * ⚠️ `updatedAt`, not `createdAt`, is when the run was measured. One row is
 * one project-branch-day and later pushes upsert onto it, so `createdAt` is
 * the first push of that day and only `updatedAt` moves with the run the row
 * actually describes. The staleness line reads `updatedAt` for exactly that
 * reason.
 */
export const qualityRunSchema = z.object({
  id: z.uuid(),
  projectId: z.integer(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * UTC day bucket, `YYYY-MM-DD`. The x axis of every graph on the tab.
   */
  day: z.string(),
  commitSha: z.string(),
  branch: z.string(),
  coverageLines: z.number(),
  coverageStatements: z.number(),
  coverageFunctions: z.number(),
  coverageBranches: z.number(),
  testsTotal: z.integer(),
  testsPassed: z.integer(),
  testsFailed: z.integer(),
  /**
   * `numPendingTests` + `numTodoTests`. See the entity's column comment.
   */
  testsSkipped: z.integer(),
  durationMs: z.integer(),
});

export type QualityRunResource = Infer<typeof qualityRunSchema>;
