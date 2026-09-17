import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

export const paymentIntents = $entity({
  name: "payment_intents",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    amount: z.integer(),
    currency: z.text({ size: "short" }),
    status: z.enum([
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
    providerRef: z.text().optional(),
    /**
     * PSP sub-account the session was created on (a Stripe connected
     * account, `acct_…`, for a direct charge). Every later call about this
     * intent must name it: the PSP knows the session only there.
     */
    providerAccount: z.text().optional(),
    providerRaw: z.json().optional(),
    metadata: z.json().optional(),
    paymentMethodId: z.uuid().optional(),
    userId: z.uuid().optional(),
  }),
  indexes: ["status", "userId", "createdAt"],
});

export type PaymentIntentEntity = Infer<typeof paymentIntents.schema>;
