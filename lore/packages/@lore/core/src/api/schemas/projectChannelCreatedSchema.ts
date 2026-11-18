import { type Infer, z } from "alepha";

import { projectChannelResourceSchema } from "./projectChannelResourceSchema.ts";

/**
 * A channel just added or whose secret was just rotated (#Q3900): a webhook
 * channel's signing secret, in clear, this once.
 */
export const projectChannelCreatedSchema = projectChannelResourceSchema.extend({
  secret: z.string().max(128).optional(),
});

export type ProjectChannelCreated = Infer<typeof projectChannelCreatedSchema>;
