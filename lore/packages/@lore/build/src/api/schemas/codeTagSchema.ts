import { z } from "alepha";

import { codeCommitSummarySchema } from "./codeCommitSummarySchema.ts";

/**
 * A tag and the commit it points at, an annotated one peeled (#Q4137).
 */
export const codeTagSchema = z.object({
  name: z.text({ maxLength: 255 }),
  sha: z.text({ minLength: 40, maxLength: 40 }),
  commit: codeCommitSummarySchema.optional(),
});
