import { type Infer, z } from "alepha";

import { subscriptionChannelSchema } from "./subscriptionChannelSchema.ts";

/**
 * One subscription as the API returns it (#Q3890): a member with their
 * channels, or a notification channel (#Q3891). Never a channel's URL.
 */
export const subscriptionResourceSchema = z.object({
  id: z.uuid(),
  projectId: z.integer(),
  event: z.string(),
  filter: z.string().optional(),
  memberId: z.uuid().optional(),
  channelId: z.string().optional(),
  channels: z.array(subscriptionChannelSchema),
  createdBy: z.uuid().optional(),
  mutedAt: z.datetime().optional(),
  createdAt: z.datetime(),
});

export type SubscriptionResource = Infer<typeof subscriptionResourceSchema>;
