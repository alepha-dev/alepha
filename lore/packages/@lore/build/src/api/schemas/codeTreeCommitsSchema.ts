import { z } from "alepha";

import { codeCommitSummarySchema } from "./codeCommitSummarySchema.ts";

/**
 * The last commit that touched each entry of a directory (#Q4134), read
 * from the commit index, beside the tree rather than in it: the tree draws
 * at once, and these fill in.
 */
export const codeTreeCommitsSchema = z.object({
  entries: z.array(
    z.object({
      name: z.text({ maxLength: 1024 }),
      commit: codeCommitSummarySchema,
    }),
  ),
  /**
   * The index lacks the revision's tip: the column stays empty for now.
   */
  indexing: z.boolean(),
});
