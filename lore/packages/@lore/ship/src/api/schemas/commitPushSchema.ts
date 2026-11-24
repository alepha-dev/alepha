import { type Infer, z } from "alepha";

import { commitQuestSetPushSchema } from "./commitQuestSetPushSchema.ts";

/**
 * A bare commit push (#Q4234): the quests a commit's history references,
 * with no artifact, for a project that does not deploy through Lore. What
 * `lore commits push` sends from CI on the default branch.
 */
export const commitPushSchema = z.object({
  commitSha: z.string().regex(/^[0-9a-fA-F]{7,40}$/),
  quests: commitQuestSetPushSchema,
  /**
   * The shas the pusher walked (`base..HEAD`): Lore matches the quests whose
   * recorded sha is among them. A whole first history goes through the
   * artifact push's file part; this one is for CI's incremental walk.
   */
  walked: z.array(z.string().regex(/^[0-9a-fA-F]{7,40}$/)).max(20_000),
  /**
   * The branch the commit was pushed on, and the repository's default
   * branch as the pusher read it (`main` when it could not). A commit on
   * the default branch completes the quests an automation built that its
   * history names.
   */
  branch: z.string().max(255).optional(),
  defaultBranch: z.string().max(255).optional(),
});

export type CommitPush = Infer<typeof commitPushSchema>;
