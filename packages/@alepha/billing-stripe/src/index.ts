import { $module } from "alepha";
import { AlephaBilling, BillingProvider } from "alepha/billing";
import { StripeBillingProvider } from "./providers/StripeBillingProvider.ts";

export * from "./providers/StripeBillingProvider.ts";

export const AlephaBillingStripe = $module({
  name: "alepha.billing.stripe",
  services: [StripeBillingProvider],
  register: (alepha) =>
    alepha
      .with({ provide: BillingProvider, use: StripeBillingProvider })
      .with(AlephaBilling),
});
