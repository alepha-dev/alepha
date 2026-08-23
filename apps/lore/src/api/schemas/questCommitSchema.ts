import { type Infer, z } from "alepha";

/**
 * One commit recorded against a quest.
 *
 * What this replaces: "what shipped for #16" was answered by grepping
 * `git log` for the quest number in commit bodies. That works only because
 * the owner writes disciplined messages, it is pattern matching on prose,
 * and an agent in a fresh worktree without the full history cannot do it at
 * all. Completion messages sometimes carried a sha and sometimes did not.
 *
 * `repo` is free text and defaults to nothing: Lore does not know a
 * project's repository and should not pretend to. That is also why the UI
 * row has no link target.
 */
export const questCommitSchema = z.object({
  /**
   * Short or full hex sha, 7 to 40 characters.
   */
  sha: z.string().min(7).max(40),
  /**
   * The commit subject, when the caller has it.
   */
  message: z.string().max(500).optional(),
  /**
   * e.g. `feunard/alepha`. Free text; Lore never resolves it.
   */
  repo: z.string().max(200).optional(),
  at: z.datetime(),
  by: z.uuid(),
});

export type QuestCommit = Infer<typeof questCommitSchema>;
