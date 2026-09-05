import { $module } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail } from "alepha/email";

import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { cartRecoveryConfig } from "./cartRecoveryConfigAtom.ts";
import {
  CartRecoveryMailRenderer,
  DefaultCartRecoveryMailRenderer,
} from "./providers/CartRecoveryMailRenderer.ts";
import { CartRecoveryJobs } from "./services/CartRecoveryJobs.ts";
import { CartRecoveryListener } from "./services/CartRecoveryListener.ts";
import { CartRecoveryService } from "./services/CartRecoveryService.ts";

export * from "./cartRecoveryConfigAtom.ts";
export * from "./providers/CartRecoveryMailRenderer.ts";
export * from "./services/CartRecoveryJobs.ts";
export * from "./services/CartRecoveryListener.ts";
export * from "./services/CartRecoveryService.ts";

/**
 * Abandoned-cart follow-up: two reminder emails and an abandoned mark, as
 * one durable job per cart.
 *
 * Starts when a checkout captures an email (`commerce:checkout:email`),
 * waits out its delays on the job's own execution row (restarts lose
 * nothing) and stands down the moment the checkout converts. Timings come
 * from `cartRecoveryConfig`; the wording from `CartRecoveryMailRenderer`,
 * substitutable like the order mails:
 *
 * ```ts
 * alepha.with({ provide: CartRecoveryMailRenderer, use: MyReminders });
 * ```
 *
 * @module alepha.commerce.recovery
 */
export const AlephaCommerceRecovery = $module({
  name: "alepha.commerce.recovery",
  imports: [AlephaCommerceCheckout, AlephaApiJobs, AlephaEmail],
  atoms: [cartRecoveryConfig],
  services: [
    CartRecoveryService,
    CartRecoveryJobs,
    CartRecoveryListener,
    CartRecoveryMailRenderer,
  ],
  variants: [DefaultCartRecoveryMailRenderer],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: CartRecoveryMailRenderer,
      use: DefaultCartRecoveryMailRenderer,
    });
  },
});
