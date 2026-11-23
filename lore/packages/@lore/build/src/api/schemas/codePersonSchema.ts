import { z } from "alepha";

/**
 * A commit's author or committer as git recorded them (#Q4136), `at` in
 * epoch seconds.
 */
export const codePersonSchema = z.object({
  name: z.text({ maxLength: 500 }),
  email: z.text({ maxLength: 500 }),
  at: z.integer(),
});
