import { type Infer, z } from "alepha";

import { subscriptionChannelSchema } from "./subscriptionChannelSchema.ts";

/**
 * Subscribe a member to an event (#Q3890). `memberId` defaults to the
 * caller; naming anyone else needs `subscription:manage`. Setting the same
 * event, filter and member again replaces the channels.
 */
export const subscriptionSetBodySchema = z.object({
  event: z.string().min(1).max(64),
  filter: z.string().min(1).max(255).optional(),
  memberId: z.uuid().optional(),
  channels: z.array(subscriptionChannelSchema).min(1).max(2),
});

export type SubscriptionSetBody = Infer<typeof subscriptionSetBodySchema>;
