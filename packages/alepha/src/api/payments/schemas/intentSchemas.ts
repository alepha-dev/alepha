import type { Static } from "alepha";
import { z } from "alepha";
import { pageQuerySchema } from "alepha/orm";
import { paymentIntents } from "../entities/paymentIntents.ts";

export const createIntentSchema = z.object({
  amount: z.integer().min(1),
  currency: z.text({ size: "short" }),
  metadata: z.json().optional(),
  paymentMethodId: z.uuid().optional(),
});

export type CreateIntent = Static<typeof createIntentSchema>;

export const createCheckoutSchema = z.object({
  intentId: z.uuid(),
  returnUrl: z.text(),
  authorize: z.boolean().optional(),
});

export type CreateCheckout = Static<typeof createCheckoutSchema>;

export const checkoutResponseSchema = z.object({
  url: z.text(),
  intentId: z.text(),
});

export type CheckoutResponse = Static<typeof checkoutResponseSchema>;

export const captureIntentSchema = z.object({
  amount: z.integer().min(1).optional(),
});

export type CaptureIntent = Static<typeof captureIntentSchema>;

export const refundIntentSchema = z.object({
  amount: z.integer().min(1),
  reason: z.text().optional(),
});

export type RefundIntent = Static<typeof refundIntentSchema>;

export const recordCashSchema = z.object({
  amount: z.integer().min(1),
  currency: z.text({ size: "short" }),
  metadata: z.json().optional(),
});

export type RecordCash = Static<typeof recordCashSchema>;

export const intentQuerySchema = pageQuerySchema.extend({
  status: z.text({ description: "Filter by status" }).optional(),
  userId: z.uuid().describe("Filter by user ID").optional(),
});

export type IntentQuery = Static<typeof intentQuerySchema>;

export const intentResourceSchema = paymentIntents.schema;

export type IntentResource = Static<typeof intentResourceSchema>;
