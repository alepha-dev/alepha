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
