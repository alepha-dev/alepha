import type { Infer } from "alepha";
import { z } from "alepha";
import { paymentMethods } from "../entities/paymentMethods.ts";

export const addPaymentMethodSchema = z.object({
  token: z.text(),
});

export type AddPaymentMethod = Infer<typeof addPaymentMethodSchema>;

export const paymentMethodResourceSchema = paymentMethods.schema;

export type PaymentMethodResource = Infer<typeof paymentMethodResourceSchema>;
