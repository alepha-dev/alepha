import { $module } from "alepha";
import { AlephaApiWorkflows } from "alepha/api/workflows";
import { AlephaEmail } from "alepha/email";

import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { cartRecoveryConfig } from "./cartRecoveryConfigAtom.ts";
import {
  CartRecoveryMailRenderer,
  DefaultCartRecoveryMailRenderer,
} from "./providers/CartRecoveryMailRenderer.ts";
import { CartRecoveryListener } from "./services/CartRecoveryListener.ts";
import { CartRecoveryService } from "./services/CartRecoveryService.ts";
import { CartRecoveryWorkflows } from "./services/CartRecoveryWorkflows.ts";

export * from "./cartRecoveryConfigAtom.ts";
export * from "./providers/CartRecoveryMailRenderer.ts";
export * from "./services/CartRecoveryListener.ts";
export * from "./services/CartRecoveryService.ts";
export * from "./services/CartRecoveryWorkflows.ts";

/**
 * Abandoned-cart follow-up: two reminder emails and an abandoned mark,
 * as one durable workflow per cart.
 *
 * Starts when a checkout captures an email (`commerce:checkout:email`),
 * waits out its delays inside the workflow engine — restarts lose
 * nothing — and stands down the moment the checkout converts. Timings
 * come from `cartRecoveryConfig`; the wording from
 * `CartRecoveryMailRenderer`, substitutable like the order mails:
 *
 * ```ts
 * alepha.with({ provide: CartRecoveryMailRenderer, use: MyReminders });
 * ```
 *
 * @module alepha.commerce.recovery
 */
export const AlephaCommerceRecovery = $module({
  name: "alepha.commerce.recovery",
  imports: [AlephaCommerceCheckout, AlephaApiWorkflows, AlephaEmail],
  atoms: [cartRecoveryConfig],
  services: [
    CartRecoveryService,
    CartRecoveryWorkflows,
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
