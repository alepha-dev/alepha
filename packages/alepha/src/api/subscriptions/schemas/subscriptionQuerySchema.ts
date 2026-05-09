import { type Static, t } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const subscriptionQuerySchema = t.extend(pageQuerySchema, {
  status: t.optional(
    t.enum([
      "trialing",
      "active",
      "past_due",
      "suspended",
      "cancelled",
      "expired",
    ]),
  ),
  planId: t.optional(t.string()),
  organizationId: t.optional(t.uuid()),
});

export type SubscriptionQuery = Static<typeof subscriptionQuerySchema>;
