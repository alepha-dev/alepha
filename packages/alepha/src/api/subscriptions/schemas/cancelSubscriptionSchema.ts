import { type Static, t } from "alepha";

export const cancelSubscriptionSchema = t.object({
  reason: t.optional(t.string()),
  immediate: t.optional(t.boolean()),
});

export type CancelSubscription = Static<typeof cancelSubscriptionSchema>;
