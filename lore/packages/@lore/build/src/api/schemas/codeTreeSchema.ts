import { z } from "alepha";

import { codeRevisionSchema } from "./codeRevisionSchema.ts";

export const codeTreeEntrySchema = z.object({
  name: z.text({ maxLength: 1024 }),
  /**
   * From the repository's root.
   */
  path: z.text({ maxLength: 4096 }),
  type: z.enum(["blob", "tree", "commit"]),
  mode: z.text({ maxLength: 10 }),
  sha: z.text({ minLength: 40, maxLength: 40 }),
});

/**
 * One directory at a revision (#Q4134): folders first, then files, each
 * alphabetical, and its README's text when it has one.
 */
export const codeTreeSchema = z.object({
  revision: codeRevisionSchema,
  path: z.text({ maxLength: 4096 }),
  entries: z.array(codeTreeEntrySchema),
  readme: z
    .object({
      path: z.text({ maxLength: 4096 }),
      text: z.string(),
    })
    .optional(),
});
