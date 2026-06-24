import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";

export const subscriptions = $entity({
  name: "subscriptions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),

    // Plan
    planId: z.string(),
    interval: z.enum(["monthly", "yearly"]),

    // Status
    status: z.enum([
      "trialing",
      "active",
      "past_due",
      "suspended",
      "cancelled",
      "expired",
    ]),

    // Billing cycle
    currentPeriodStart: z.datetime(),
    currentPeriodEnd: z.datetime(),

    // Trial
    trialStart: z.datetime().optional(),
    trialEnd: z.datetime().optional(),

    // Cancellation
    cancelledAt: z.datetime().optional(),
    cancelReason: z.string().optional(),
    cancelAtPeriodEnd: z.boolean().default(false),

    // Payment tracking
    lastPaymentIntentId: z.uuid().optional(),
    lastPaymentAt: z.datetime().optional(),
    nextBillingAt: z.datetime().optional(),

    // Dunning state
    dunningStartedAt: z.datetime().optional(),
    dunningAttempt: z.integer().default(0),
    dunningNextRetryAt: z.datetime().optional(),

    // Plan change (pending)
    pendingPlanId: z.string().optional(),
    pendingInterval: z.enum(["monthly", "yearly"]).optional(),

    // Metadata
    metadata: z.record(z.text(), z.any()).optional(),
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
