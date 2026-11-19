import { z } from "alepha";

import { projectParamsSchema } from "./projectParamsSchema.ts";

/**
 * `inbox_list` and `inbox_read` (#Q3914): the caller's own inbox, every
 * project by default, one when `project` names it.
 */
export const inboxListParamsSchema = projectParamsSchema.extend({
  unread: z.boolean().describe("Only what you have not read.").optional(),
  limit: z.integer().min(1).max(100).describe("How many, 1 to 100.").optional(),
  cursor: z
    .string()
    .max(200)
    .describe("The next page, as the previous one returned it.")
    .optional(),
  id: z
    .string()
    .max(64)
    .describe("For inbox_read: the message to mark read.")
    .optional(),
  all: z
    .boolean()
    .describe(
      "For inbox_read: mark every message read (in `project` only, when given).",
    )
    .optional(),
});
