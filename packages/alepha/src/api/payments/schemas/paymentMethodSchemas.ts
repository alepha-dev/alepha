import type { Static } from "alepha";
import { z } from "alepha";
import { paymentMethods } from "../entities/paymentMethods.ts";

export const addPaymentMethodSchema = z.object({
  token: z.text(),
});

export type AddPaymentMethod = Static<typeof addPaymentMethodSchema>;

export const paymentMethodResourceSchema = paymentMethods.schema;

export type PaymentMethodResource = Static<typeof paymentMethodResourceSchema>;
