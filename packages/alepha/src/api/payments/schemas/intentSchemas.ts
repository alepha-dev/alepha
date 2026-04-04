import type { Static } from "alepha";
import { t } from "alepha";
import { pageQuerySchema } from "alepha/orm";
import { paymentIntents } from "../entities/paymentIntents.ts";

export const createIntentSchema = t.object({
  amount: t.integer({ minimum: 1 }),
  currency: t.text({ size: "short" }),
  metadata: t.optional(t.json()),
  paymentMethodId: t.optional(t.uuid()),
});

export type CreateIntent = Static<typeof createIntentSchema>;

export const createCheckoutSchema = t.object({
  intentId: t.uuid(),
  returnUrl: t.text(),
  authorize: t.optional(t.boolean()),
});

export type CreateCheckout = Static<typeof createCheckoutSchema>;

export const checkoutResponseSchema = t.object({
  url: t.text(),
  intentId: t.text(),
});

export type CheckoutResponse = Static<typeof checkoutResponseSchema>;

export const captureIntentSchema = t.object({
  amount: t.optional(t.integer({ minimum: 1 })),
});

export type CaptureIntent = Static<typeof captureIntentSchema>;

export const refundIntentSchema = t.object({
  amount: t.integer({ minimum: 1 }),
  reason: t.optional(t.text()),
});

export type RefundIntent = Static<typeof refundIntentSchema>;

export const recordCashSchema = t.object({
  amount: t.integer({ minimum: 1 }),
  currency: t.text({ size: "short" }),
  metadata: t.optional(t.json()),
});

export type RecordCash = Static<typeof recordCashSchema>;

export const intentQuerySchema = t.extend(pageQuerySchema, {
  status: t.optional(t.text({ description: "Filter by status" })),
  userId: t.optional(t.uuid({ description: "Filter by user ID" })),
});

export type IntentQuery = Static<typeof intentQuerySchema>;

export const intentResourceSchema = paymentIntents.schema;

export type IntentResource = Static<typeof intentResourceSchema>;
