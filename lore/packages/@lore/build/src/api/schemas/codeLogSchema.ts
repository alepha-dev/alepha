import { z } from "alepha";

import { codeLogEntrySchema } from "./codeLogEntrySchema.ts";
import { codeRevisionSchema } from "./codeRevisionSchema.ts";

/**
 * A page of a revision's history, of a file or a folder when `path` is set
 * (#Q4136), read from the commit index.
 */
export const codeLogSchema = z.object({
  revision: codeRevisionSchema,
  path: z.text({ maxLength: 4096 }),
  commits: z.array(codeLogEntrySchema),
  page: z.integer(),
  more: z.boolean(),
  /**
   * The index has not reached the revision's tip yet.
   */
  indexing: z.boolean(),
});
