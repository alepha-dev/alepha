import { z } from "alepha";

import { projectParamsSchema } from "./projectParamsSchema.ts";

/**
 * `event_list` (#Q3895).
 */
export const eventListParamsSchema = projectParamsSchema.extend({
  name: z
    .string()
    .max(64)
    .describe("Only this event, by name (`host.offline`).")
    .optional(),
  subject: z
    .string()
    .max(255)
    .describe(
      "Only events about this subject id: a quest's or a feedback's number, a host's or a deployment's id.",
    )
    .optional(),
  limit: z
    .integer()
    .min(1)
    .max(100)
    .describe("At most this many (20).")
    .optional(),
  offset: z.integer().min(0).max(10_000).describe("Skip this many.").optional(),
});
