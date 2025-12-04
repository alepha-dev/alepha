import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

export const payments = $entity({
  name: "payments",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    // Reference to booking
    bookingId: t.uuid(),
    bookingReference: t.text(),

    // Payment details
    amount: t.number(),
    currency: pg.default(t.text(), "EUR"),

    // Payment method
    method: t.enum([
      "card",
      "paypal",
      "bank_transfer",
      "apple_pay",
      "google_pay",
    ]),
    cardLast4: t.optional(t.text({ minLength: 4, maxLength: 4 })),
    cardBrand: t.optional(t.text()),

    // Transaction info
    transactionId: t.optional(t.text()),
    payerEmail: t.email(),

    // Status
    status: pg.default(
      t.enum(["pending", "processing", "completed", "failed", "refunded"]),
      "pending",
    ),
    failureReason: t.optional(t.text()),

    // Refund info
    refundedAt: t.optional(t.string()),
    refundAmount: t.optional(t.number()),
  }),
  indexes: [
    { columns: ["bookingId"] },
    { columns: ["transactionId"], unique: true },
  ],
});

export type Payment = Static<typeof payments.schema>;
