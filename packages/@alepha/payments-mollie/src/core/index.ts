import { $module } from "alepha";
import { AlephaApiPayments, PaymentProvider } from "alepha/api/payments";
import { MolliePaymentProvider } from "./providers/MolliePaymentProvider.ts";

export * from "./providers/MolliePaymentProvider.ts";

export const AlephaPaymentsMollie = $module({
  name: "alepha.payments.mollie",
  services: [MolliePaymentProvider],
  imports: [AlephaApiPayments],
  register: (alepha) =>
    alepha.with({ provide: PaymentProvider, use: MolliePaymentProvider }),
});
