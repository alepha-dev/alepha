import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";
import { subscriptions } from "./subscriptions.ts";

export const subscriptionEvents = $entity({
  name: "subscription_events",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),
    subscriptionId: db.ref(t.uuid(), () => subscriptions.cols.id, {
      onDelete: "cascade",
    }),
    organizationId: db.organization(),

    type: t.enum([
      "created",
      "trial_started",
      "trial_ended",
      "activated",
      "renewed",
      "payment_failed",
      "payment_retried",
      "past_due",
      "suspended",
      "reactivated",
      "plan_changed",
      "plan_change_scheduled",
      "cancelled",
      "expired",
      "resumed",
    ]),

    // Context
    previousStatus: t.optional(t.string()),
    newStatus: t.optional(t.string()),
    previousPlanId: t.optional(t.string()),
    newPlanId: t.optional(t.string()),
    paymentIntentId: t.optional(t.uuid()),
    amount: t.optional(t.integer()),
    currency: t.optional(t.string()),

    // Who / why
    triggeredBy: t.optional(t.string()),
    userId: t.optional(t.uuid()),
    note: t.optional(t.string()),
  }),
  indexes: [
    { columns: ["subscriptionId", "createdAt"] },
    { columns: ["organizationId", "createdAt"] },
    { columns: ["type"] },
  ],
});

export type SubscriptionEventEntity = Static<typeof subscriptionEvents.schema>;
