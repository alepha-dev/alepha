import { type Static, z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const subscriptionQuerySchema = pageQuerySchema.extend({
  status: z
    .enum([
      "trialing",
      "active",
      "past_due",
      "suspended",
      "cancelled",
      "expired",
    ])
    .optional(),
  planId: z.string().optional(),
  organizationId: z.uuid().optional(),
});

export type SubscriptionQuery = Static<typeof subscriptionQuerySchema>;
