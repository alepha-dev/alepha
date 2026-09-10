import { type Infer, z } from "alepha";

/**
 * A worktree's working-tree state, from `git status --porcelain=v2 --branch`.
 */
export const gitStatusSchema = z.object({
  /**
   * Changes in the index.
   */
  staged: z.integer(),
  /**
   * Changes in the working tree that are not staged.
   */
  modified: z.integer(),
  untracked: z.integer(),
  conflicted: z.integer(),
  /**
   * The branch's upstream (`origin/worktree-x`), when it has one.
   */
  upstream: z.string().optional(),
  /**
   * Commits on the branch that its upstream lacks, and the reverse.
   */
  ahead: z.integer(),
  behind: z.integer(),
});

export type GitStatus = Infer<typeof gitStatusSchema>;
