import { $module } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";

import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { AlephaCommerce } from "../index.ts";
import { SettlementJobs } from "./services/SettlementJobs.ts";
import { SettlementListener } from "./services/SettlementListener.ts";
import { settlementConfig } from "./settlementConfigAtom.ts";

export * from "./services/SettlementJobs.ts";
export * from "./services/SettlementListener.ts";
export * from "./settlementConfigAtom.ts";

/**
 * Durable checkout outcomes, two jobs:
 *
 * - **orderSettlement**: invoice and confirmation email as one keyed
 *   `$job` with retry and admin visibility, replacing the fire-and-forget
 *   listeners that silently dropped a failed invoice.
 * - **checkoutReconciliation**: one delayed execution per payment handoff:
 *   a checkout still `paying` after the wait gets the PSP polled
 *   (recovering payments whose webhook never arrived, the
 *   Mollie-without-webhook case) and is settled or abandoned either way.
 *
 * Import this ALONGSIDE `@alepha/commerce/invoicing` and/or
 * `@alepha/commerce/notifications`: the settlement stages activate for
 * whichever of the two is loaded and skip cleanly otherwise. Without this
 * module, invoicing and notifications do nothing on the paid transition:
 * the paid-path side effects live here, on purpose, so they can never run
 * twice.
 *
 * @module alepha.commerce.settlement
 */
export const AlephaCommerceSettlement = $module({
  name: "alepha.commerce.settlement",
  imports: [AlephaCommerce, AlephaCommerceCheckout, AlephaApiJobs],
  atoms: [settlementConfig],
  services: [SettlementJobs, SettlementListener],
});
