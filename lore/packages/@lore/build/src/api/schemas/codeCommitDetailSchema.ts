import { z } from "alepha";

import { codeAuthorSchema } from "./codeAuthorSchema.ts";
import { codePersonSchema } from "./codePersonSchema.ts";
import { codeQuestRefSchema } from "./codeQuestRefSchema.ts";

/**
 * One commit as its page shows it (#Q4136): the message, who wrote and
 * who committed it, its parents, and its quests. The diff is read beside it,
 * against `parents[0]` (the empty tree for a root commit).
 */
export const codeCommitDetailSchema = z.object({
  sha: z.text({ minLength: 40, maxLength: 40 }),
  parents: z.array(z.text({ minLength: 40, maxLength: 40 })),
  subject: z.text({ maxLength: 4000 }),
  body: z.string(),
  author: codePersonSchema,
  committer: codePersonSchema,
  member: codeAuthorSchema.optional(),
  quests: z.array(codeQuestRefSchema),
});
