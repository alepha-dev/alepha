import { z } from "alepha";

/**
 * A branch or a tag, its short name and the commit it points at (#E167):
 * an annotated tag answers the peeled commit, never the tag object.
 */
export const codeRefSchema = z.object({
  name: z.text({ maxLength: 255 }),
  sha: z.text({ minLength: 40, maxLength: 40 }),
});
