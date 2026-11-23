import { z } from "alepha";

import { codeCommitSummarySchema } from "./codeCommitSummarySchema.ts";
import { codeRefSchema } from "./codeRefSchema.ts";
import { codeRepositorySchema } from "./codeRepositorySchema.ts";

/**
 * A repository's page header (#Q4133): the repository, its branches and
 * tags, and its default branch's last commit.
 */
export const codeRepositoryDetailSchema = z.object({
  repository: codeRepositorySchema,
  branches: z.array(codeRefSchema),
  tags: z.array(codeRefSchema),
  /**
   * The default branch's last commit; absent on an empty repository.
   */
  head: codeCommitSummarySchema.optional(),
  /**
   * The commit index has not reached the default branch's tip yet: history
   * and blame are partial until the backfill catches up.
   */
  indexing: z.boolean(),
});
