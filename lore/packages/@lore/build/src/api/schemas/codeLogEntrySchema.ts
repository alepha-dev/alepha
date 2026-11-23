import { z } from "alepha";

import { codeAuthorSchema } from "./codeAuthorSchema.ts";
import { codeCommitSummarySchema } from "./codeCommitSummarySchema.ts";
import { codeQuestRefSchema } from "./codeQuestRefSchema.ts";

/**
 * One row of a history (#Q4136): the commit, its quests, and the member
 * its author is when the email matches one.
 */
export const codeLogEntrySchema = codeCommitSummarySchema.extend({
  quests: z.array(codeQuestRefSchema),
  member: codeAuthorSchema.optional(),
});
