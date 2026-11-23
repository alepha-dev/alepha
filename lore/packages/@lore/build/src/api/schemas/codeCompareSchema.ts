import { z } from "alepha";

import { codeLogEntrySchema } from "./codeLogEntrySchema.ts";
import { codeRevisionSchema } from "./codeRevisionSchema.ts";

/**
 * Two revisions compared (#Q4137): `head`'s commits since the merge base,
 * newest first and capped at 100, and the counts both ways. The diff is
 * read beside it, from the merge base to `head`.
 */
export const codeCompareSchema = z.object({
  base: codeRevisionSchema,
  head: codeRevisionSchema,
  mergeBase: z.text({ minLength: 40, maxLength: 40 }).optional(),
  mergeBaseCapped: z.boolean(),
  commits: z.array(codeLogEntrySchema),
  ahead: z.integer(),
  behind: z.integer(),
  aheadCapped: z.boolean(),
  behindCapped: z.boolean(),
  indexing: z.boolean(),
});
