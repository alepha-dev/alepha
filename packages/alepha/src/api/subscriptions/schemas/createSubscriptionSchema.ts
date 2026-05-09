import { type Static, t } from "alepha";

export const createSubscriptionSchema = t.object({
  planId: t.string(),
  interval: t.enum(["monthly", "yearly"]),
  paymentMethodId: t.optional(t.uuid()),
  skipTrial: t.optional(t.boolean()),
  metadata: t.optional(t.record(t.text(), t.any())),
});

export type CreateSubscription = Static<typeof createSubscriptionSchema>;
