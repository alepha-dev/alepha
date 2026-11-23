import { z } from "alepha";

import { codeCommitSummarySchema } from "./codeCommitSummarySchema.ts";

/**
 * A branch as the Branches page lists it (#Q4137): its last commit, and how
 * far it is ahead of and behind the default branch, counted on the commit
 * index and capped at 100 (`aheadCapped` reads "100+").
 */
export const codeBranchSchema = z.object({
  name: z.text({ maxLength: 255 }),
  sha: z.text({ minLength: 40, maxLength: 40 }),
  isDefault: z.boolean(),
  commit: codeCommitSummarySchema.optional(),
  ahead: z.integer(),
  behind: z.integer(),
  aheadCapped: z.boolean(),
  behindCapped: z.boolean(),
  /**
   * The index lacks this branch or the default one: the counts are not
   * known yet.
   */
  indexing: z.boolean(),
});
