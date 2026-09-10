import { type Infer, z } from "alepha";

/**
 * One commit, as a worktree's last commit.
 */
export const commitSchema = z.object({
  sha: z.string(),
  subject: z.string(),
  author: z.string(),
  /**
   * Committer date, ISO 8601.
   */
  date: z.string(),
});

export type Commit = Infer<typeof commitSchema>;
