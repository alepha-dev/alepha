import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { subscriptions } from "./subscriptions.ts";

export const subscriptionEvents = $entity({
  name: "subscription_events",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    subscriptionId: db.ref(z.uuid(), () => subscriptions.cols.id, {
      onDelete: "cascade",
    }),
    organizationId: db.organization(),

    type: z.enum([
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
    previousStatus: z.string().optional(),
    newStatus: z.string().optional(),
    previousPlanId: z.string().optional(),
    newPlanId: z.string().optional(),
    paymentIntentId: z.uuid().optional(),
    amount: z.integer().optional(),
    currency: z.string().optional(),

    // Who / why
    triggeredBy: z.string().optional(),
    userId: z.uuid().optional(),
    note: z.string().optional(),
  }),
  indexes: [
    { columns: ["subscriptionId", "createdAt"] },
    { columns: ["organizationId", "createdAt"] },
    { columns: ["type"] },
  ],
});

export type SubscriptionEventEntity = Static<typeof subscriptionEvents.schema>;
