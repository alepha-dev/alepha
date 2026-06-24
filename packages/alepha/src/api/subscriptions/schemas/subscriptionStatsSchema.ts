import { type Static, z } from "alepha";

export const subscriptionStatsSchema = z.object({
  total: z.integer(),
  trialing: z.integer(),
  active: z.integer(),
  pastDue: z.integer(),
  suspended: z.integer(),
  cancelled: z.integer(),
  expired: z.integer(),
  trialConversionRate: z.number(),
  churnRate: z.number(),
  byPlan: z.record(
    z.text(),
    z.object({
      active: z.integer(),
      trialing: z.integer(),
      total: z.integer(),
    }),
  ),
});

export type SubscriptionStats = Static<typeof subscriptionStatsSchema>;
