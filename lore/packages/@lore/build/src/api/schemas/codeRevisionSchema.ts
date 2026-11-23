import { z } from "alepha";

/**
 * What a revision in a code URL resolved to (#Q4134): the branch, tag or
 * commit it named, and the commit itself. A page swaps `name` for `sha` to
 * make a permalink.
 */
export const codeRevisionSchema = z.object({
  name: z.text({ maxLength: 255 }),
  kind: z.enum(["branch", "tag", "commit"]),
  sha: z.text({ minLength: 40, maxLength: 40 }),
});
