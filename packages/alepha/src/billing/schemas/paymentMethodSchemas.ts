import type { Static } from "alepha";
import { t } from "alepha";
import { paymentMethods } from "../entities/paymentMethods.ts";

export const addPaymentMethodSchema = t.object({
  token: t.text(),
});

export type AddPaymentMethod = Static<typeof addPaymentMethodSchema>;

export const paymentMethodResourceSchema = paymentMethods.schema;

export type PaymentMethodResource = Static<typeof paymentMethodResourceSchema>;
