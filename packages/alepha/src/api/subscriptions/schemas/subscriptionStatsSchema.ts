import { type Static, t } from "alepha";

export const subscriptionStatsSchema = t.object({
  total: t.integer(),
  trialing: t.integer(),
  active: t.integer(),
  pastDue: t.integer(),
  suspended: t.integer(),
  cancelled: t.integer(),
  expired: t.integer(),
  trialConversionRate: t.number(),
  churnRate: t.number(),
  byPlan: t.record(
    t.text(),
    t.object({
      active: t.integer(),
      trialing: t.integer(),
      total: t.integer(),
    }),
  ),
});

export type SubscriptionStats = Static<typeof subscriptionStatsSchema>;
