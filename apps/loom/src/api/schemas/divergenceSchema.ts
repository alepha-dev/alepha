import { type Infer, z } from "alepha";

/**
 * How far a worktree's HEAD has moved from the default branch.
 */
export const divergenceSchema = z.object({
  /**
   * The ref compared against, `origin/main` in practice.
   */
  base: z.string(),
  /**
   * Commits on HEAD that the base lacks: the branch's own work.
   */
  ahead: z.integer(),
  /**
   * Commits on the base that HEAD lacks: how stale the branch is.
   */
  behind: z.integer(),
});

export type Divergence = Infer<typeof divergenceSchema>;
