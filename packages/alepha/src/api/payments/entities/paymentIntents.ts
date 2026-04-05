import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";

export const paymentIntents = $entity({
  name: "payment_intents",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),
    amount: t.integer(),
    currency: t.text({ size: "short" }),
    status: t.enum([
      "created",
      "processing",
      "authorized",
      "captured",
      "partially_refunded",
      "voided",
      "failed",
      "cancelled",
      "refunded",
      "expired",
    ]),
    providerRef: t.optional(t.text()),
    providerRaw: t.optional(t.json()),
    metadata: t.optional(t.json()),
    paymentMethodId: t.optional(t.uuid()),
    userId: t.optional(t.uuid()),
  }),
  indexes: ["status", "organizationId", "userId", "createdAt"],
});

export type PaymentIntentEntity = Static<typeof paymentIntents.schema>;
