import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";

export const subscriptions = $entity({
  name: "subscriptions",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),

    // Plan
    planId: t.string(),
    interval: t.enum(["monthly", "yearly"]),

    // Status
    status: t.enum([
      "trialing",
      "active",
      "past_due",
      "suspended",
      "cancelled",
      "expired",
    ]),

    // Billing cycle
    currentPeriodStart: t.datetime(),
    currentPeriodEnd: t.datetime(),

    // Trial
    trialStart: t.optional(t.datetime()),
    trialEnd: t.optional(t.datetime()),

    // Cancellation
    cancelledAt: t.optional(t.datetime()),
    cancelReason: t.optional(t.string()),
    cancelAtPeriodEnd: t.boolean({ default: false }),

    // Payment tracking
    lastPaymentIntentId: t.optional(t.uuid()),
    lastPaymentAt: t.optional(t.datetime()),
    nextBillingAt: t.optional(t.datetime()),

    // Dunning state
    dunningStartedAt: t.optional(t.datetime()),
    dunningAttempt: t.integer({ default: 0 }),
    dunningNextRetryAt: t.optional(t.datetime()),

    // Plan change (pending)
    pendingPlanId: t.optional(t.string()),
    pendingInterval: t.optional(t.enum(["monthly", "yearly"])),

    // Metadata
    metadata: t.optional(t.record(t.text(), t.any())),
  }),
  indexes: [
    { columns: ["organizationId"], unique: true },
    { columns: ["status"] },
    { columns: ["planId", "status"] },
    { columns: ["nextBillingAt"] },
    { columns: ["trialEnd"] },
    { columns: ["dunningNextRetryAt"] },
    { columns: ["currentPeriodEnd"] },
  ],
});

export type SubscriptionEntity = Static<typeof subscriptions.schema>;
