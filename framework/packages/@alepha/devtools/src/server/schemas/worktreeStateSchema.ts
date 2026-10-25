import { type Infer, z } from "alepha";

/**
 * One git worktree, as the run picker groups apps by it.
 */
export const worktreeStateSchema = z.object({
  /**
   * The repository: its main worktree's path, shared by every worktree of it.
   */
  repository: z.text({ size: "long" }),
  /**
   * This worktree's root (a run's `gitRoot`).
   */
  worktree: z.text({ size: "long" }),
  /**
   * The checked-out branch, or `HEAD` when detached.
   */
  branch: z.text(),
  /**
   * Commits ahead of and behind the upstream. Absent without an upstream.
   */
  ahead: z.integer().optional(),
  behind: z.integer().optional(),
  /**
   * Changed, staged or untracked files.
   */
  dirty: z.integer(),
});

export type WorktreeState = Infer<typeof worktreeStateSchema>;
