import type { Infer } from "alepha";
import { z } from "alepha";
import { pageQuerySchema } from "alepha/orm";
import { paymentIntents } from "../entities/paymentIntents.ts";
import { paymentUserSummarySchema } from "./paymentUserSummarySchema.ts";

export const createIntentSchema = z.object({
  amount: z.integer().min(1),
  currency: z.text({ size: "short" }),
  metadata: z.json().optional(),
  paymentMethodId: z.uuid().optional(),
});

export type CreateIntent = Infer<typeof createIntentSchema>;

export const createCheckoutSchema = z.object({
  intentId: z.uuid(),
  returnUrl: z.text(),
  authorize: z.boolean().optional(),
});

export type CreateCheckout = Infer<typeof createCheckoutSchema>;

export const checkoutResponseSchema = z.object({
  url: z.text(),
  intentId: z.text(),
});

export type CheckoutResponse = Infer<typeof checkoutResponseSchema>;

export const captureIntentSchema = z.object({
  amount: z.integer().min(1).optional(),
});

export type CaptureIntent = Infer<typeof captureIntentSchema>;

export const refundIntentSchema = z.object({
  amount: z.integer().min(1),
  reason: z.text().optional(),
});

export type RefundIntent = Infer<typeof refundIntentSchema>;

export const recordCashSchema = z.object({
  amount: z.integer().min(1),
  currency: z.text({ size: "short" }),
  metadata: z.json().optional(),
});

export type RecordCash = Infer<typeof recordCashSchema>;

export const intentQuerySchema = pageQuerySchema.extend({
  status: z.text({ description: "Filter by status" }).optional(),
  userId: z.uuid().describe("Filter by user ID").optional(),
});

export type IntentQuery = Infer<typeof intentQuerySchema>;

export const intentResourceSchema = paymentIntents.schema.extend({
  /**
   * Paying-user summary, embedded by the admin listing via a best-effort
   * left join. Optional — see `paymentUserSummarySchema`.
   */
  user: paymentUserSummarySchema.optional(),
});

export type IntentResource = Infer<typeof intentResourceSchema>;
