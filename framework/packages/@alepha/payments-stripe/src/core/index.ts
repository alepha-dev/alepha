/**
 * Stripe backend for `alepha/api/payments`. Registering the module replaces
 * the default `MemoryPaymentProvider` with `StripePaymentProvider`: Checkout
 * sessions, embedded Payment Element sessions, capture/void/refund, saved
 * payment methods, signed webhooks (async verification, workerd-safe) and
 * Connect-style platform fees.
 *
 * Environment: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and for the
 * Payment Element `STRIPE_PUBLISHABLE_KEY`; `STRIPE_CONNECT_WEBHOOK_SECRET`
 * gates Connect webhooks.
 *
 * @module alepha.payments.stripe
 */
import { $module } from "alepha";
import { AlephaApiPayments, PaymentProvider } from "alepha/api/payments";

import { StripePaymentProvider } from "./providers/StripePaymentProvider.ts";

export * from "./providers/StripePaymentProvider.ts";

export const AlephaPaymentsStripe = $module({
  name: "alepha.payments.stripe",
  services: [StripePaymentProvider],
  imports: [AlephaApiPayments],
  register: (alepha) =>
    alepha.with({ provide: PaymentProvider, use: StripePaymentProvider }),
});
