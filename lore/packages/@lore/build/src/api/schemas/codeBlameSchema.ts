import { z } from "alepha";

import { codeLogEntrySchema } from "./codeLogEntrySchema.ts";
import { codeRevisionSchema } from "./codeRevisionSchema.ts";

/**
 * A file's blame at a revision (#Q4138): the file's text, its lines grouped
 * in runs of one commit, and those commits with their quests.
 *
 * `status`: `ready`; `pending`, its first commits found and the rest coming
 * (ask again); `partial`, the lines left older than `stoppedAtSha`;
 * `too_large` (over 256 KiB or 5,000 lines); `indexing`, the commit index
 * has not reached the revision yet.
 */
export const codeBlameSchema = z.object({
  revision: codeRevisionSchema,
  path: z.text({ maxLength: 4096 }),
  status: z.enum(["ready", "pending", "partial", "too_large", "indexing"]),
  text: z.string().optional(),
  ranges: z.array(
    z.object({
      startLine: z.integer(),
      endLine: z.integer(),
      /**
       * Absent on lines older than where the walk stopped.
       */
      commitSha: z.text({ minLength: 40, maxLength: 40 }).optional(),
      /**
       * The path the line had in that commit, a rename's old name.
       */
      originalPath: z.text({ maxLength: 4096 }).optional(),
    }),
  ),
  commits: z.array(codeLogEntrySchema),
  stoppedAtSha: z.text({ minLength: 40, maxLength: 40 }).optional(),
});
