import { type Infer, z } from "alepha";

import { subscriptionChannelSchema } from "./subscriptionChannelSchema.ts";

/**
 * Subscribe a member or a channel to an event (#Q3890, #Q3891). With
 * neither, the target is the caller; naming another member or a channel
 * needs `subscription:manage`. A member target takes the channels they are
 * told on; a channel target takes none. Setting the same event, filter and
 * target again replaces the channels.
 */
export const subscriptionSetBodySchema = z.object({
  event: z.string().min(1).max(64),
  filter: z.string().min(1).max(255).optional(),
  memberId: z.uuid().optional(),
  channelId: z.string().min(1).max(64).optional(),
  channels: z.array(subscriptionChannelSchema).max(2).optional(),
});

export type SubscriptionSetBody = Infer<typeof subscriptionSetBodySchema>;
