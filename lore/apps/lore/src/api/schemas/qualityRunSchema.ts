import { type Infer, z } from "alepha";

/**
 * One quality run as the API returns it.
 *
 * The four percentages and the four counts, flat, because that is what the
 * Reports tab renders and what its graphs plot. The raw reports are not here:
 * they are megabytes, nothing on the page reads them, and the point of storing
 * them is a later server-side parse rather than a payload.
 *
 * `hasReport` is the honest substitute. `quality_runs.fileId` has no foreign
 * key, so the file row can be gone while the run stays; a UI that showed a
 * "download report" affordance from `fileId` alone would offer a link to
 * nothing.
 */
export const qualityRunSchema = z.object({
  id: z.uuid(),
  projectId: z.integer(),
  createdAt: z.string(),
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
  fileId: z.uuid().optional(),
  hasReport: z.boolean(),
});

export type QualityRunResource = Infer<typeof qualityRunSchema>;
