import { z } from "alepha";

/**
 * One commit as a list shows it (#E167): the repository list's last commit,
 * a log row, a blame group's head.
 */
export const codeCommitSummarySchema = z.object({
  sha: z.text({ minLength: 40, maxLength: 40 }),
  subject: z.text({ maxLength: 4000 }),
  authorName: z.text({ maxLength: 500 }),
  authorEmail: z.text({ maxLength: 500 }),
  /**
   * Epoch seconds, as git records it.
   */
  authoredAt: z.integer(),
  committedAt: z.integer(),
  parents: z.array(z.text({ minLength: 40, maxLength: 40 })),
});
