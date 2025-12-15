import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

/**
 * Payment status values.
 */
export type PaymentStatus =
  | "pending"
  | "processing"
  | "requires_action"
  | "completed"
  | "failed"
  | "canceled"
  | "refunded"
  | "partially_refunded";

/**
 * Payment method types.
 */
export type PaymentMethod =
  | "card"
  | "paypal"
  | "bank_transfer"
  | "apple_pay"
  | "google_pay";

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
    amount: t.integer({
      description: "Amount in smallest currency unit (cents)",
    }),
    currency: pg.default(t.text(), "EUR"),

    // Payment method
    method: pg.enum([
      "card",
      "paypal",
      "bank_transfer",
      "apple_pay",
      "google_pay",
    ]),
    cardLast4: t.optional(t.text({ minLength: 4, maxLength: 4 })),
    cardBrand: t.optional(t.text()),

    // Stripe-specific fields
    stripePaymentIntentId: t.optional(
      t.text({ description: "Stripe Payment Intent ID (pi_...)" }),
    ),
    stripeClientSecret: t.optional(
      t.text({ description: "Client secret for frontend confirmation" }),
    ),
    stripeChargeId: t.optional(
      t.text({ description: "Stripe Charge ID (ch_...)" }),
    ),
    stripePaymentMethodId: t.optional(
      t.text({ description: "Stripe Payment Method ID (pm_...)" }),
    ),
    stripeReceiptUrl: t.optional(
      t.text({ description: "URL to Stripe-hosted receipt" }),
    ),

    // Legacy transaction ID (for non-Stripe payments)
    transactionId: t.optional(t.text()),
    payerEmail: t.email(),

    // Status
    status: pg.default(
      pg.enum([
        "pending",
        "processing",
        "requires_action",
        "completed",
        "failed",
        "canceled",
        "refunded",
        "partially_refunded",
      ]),
      "pending",
    ),
    failureReason: t.optional(t.text()),
    failureCode: t.optional(t.text({ description: "Stripe error code" })),

    // Refund info
    stripeRefundId: t.optional(
      t.text({ description: "Stripe Refund ID (re_...)" }),
    ),
    refundedAt: t.optional(t.string()),
    refundAmount: t.optional(t.integer()),

    // Webhook tracking
    lastWebhookEvent: t.optional(
      t.text({ description: "Last webhook event type received" }),
    ),
    lastWebhookAt: t.optional(t.datetime()),

    // Metadata
    metadata: t.optional(
      t.json({ description: "Additional payment metadata" }),
    ),
  }),
  indexes: [
    { columns: ["bookingId"] },
    { columns: ["transactionId"], unique: true },
    { columns: ["stripePaymentIntentId"], unique: true },
    { columns: ["status"] },
  ],
});

export type Payment = Static<typeof payments.schema>;
export type PaymentInsert = Omit<Payment, "id" | "createdAt" | "updatedAt">;
