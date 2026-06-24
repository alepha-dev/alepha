import { type Static, z } from "alepha";

export const cancelSubscriptionSchema = z.object({
  reason: z.string().optional(),
  immediate: z.boolean().optional(),
});

export type CancelSubscription = Static<typeof cancelSubscriptionSchema>;
