import { z } from "alepha";

/**
 * A quest a commit landed on (#Q4136), as Plan answers it through core's
 * `CommitReferenceRegistry`.
 */
export const codeQuestRefSchema = z.object({
  number: z.integer(),
  title: z.text({ maxLength: 500 }),
  status: z.text({ maxLength: 40 }),
});
