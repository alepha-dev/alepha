import { z } from "alepha";

import { codeCommitSummarySchema } from "./codeCommitSummarySchema.ts";
import { codeRepositorySlugSchema } from "./codeRepositorySlugSchema.ts";

/**
 * A repository as the API answers it: what a CLI needs to clone it.
 */
export const codeRepositorySchema = z.object({
  id: z.uuid(),
  projectId: z.integer(),
  slug: codeRepositorySlugSchema,
  defaultBranch: z.text(),
  /**
   * The HTTPS clone URL on this Lore: `/<project>/<slug>.git`, or
   * `/<project>.git` for the repository named like its project.
   */
  cloneUrl: z.text({ maxLength: 2048 }),
  /**
   * Where the repository lives: `artifacts` (Cloudflare, which caps a push
   * at unpack, so `lore code import` slices) or `local` (bare repositories
   * on disk, no cap).
   */
  backend: z.enum(["artifacts", "local"]),
  createdAt: z.datetime(),
  /**
   * The default branch's last commit, on a list (#Q4133); absent on an
   * empty repository and on a write's answer.
   */
  lastCommit: codeCommitSummarySchema.optional(),
});
