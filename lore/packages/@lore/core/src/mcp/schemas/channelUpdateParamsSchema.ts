import { z } from "alepha";

import { projectParamsSchema } from "./projectParamsSchema.ts";

/**
 * `channel_update` and `channel_delete` (#Q3914): a channel by id, and for an
 * update its new name. Never a URL: that is `lore channel update
 * --url-stdin`, so a channel's credential stays out of a model's context.
 */
export const channelUpdateParamsSchema = projectParamsSchema.extend({
  id: z.string().max(64).describe("The channel, by id (subscription_list)."),
  name: z
    .string()
    .min(1)
    .max(64)
    .describe("For channel_update: the new name.")
    .optional(),
});
