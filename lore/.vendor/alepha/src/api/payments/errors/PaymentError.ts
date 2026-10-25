import { HttpError } from "alepha/server";

/**
 * A payment operation refused: an account, an intent or a card that does not
 * belong to the caller or is not ready.
 */
export const PaymentError = HttpError.extend({
  name: "PAYMENT",
  default: { status: 400 },
  message: "Payment refused",
});

export type PaymentError = InstanceType<typeof PaymentError>;
