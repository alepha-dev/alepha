import { $module } from "alepha";
import { AlephaApiWorkflows } from "alepha/api/workflows";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { AlephaCommerce } from "../index.ts";
import { SettlementListener } from "./services/SettlementListener.ts";
import { SettlementWorkflows } from "./services/SettlementWorkflows.ts";
import { settlementConfig } from "./settlementConfigAtom.ts";

export * from "./services/SettlementListener.ts";
export * from "./services/SettlementWorkflows.ts";
export * from "./settlementConfigAtom.ts";

/**
 * Durable checkout outcomes, two workflows:
 *
 * - **orderSettlement** — invoice and confirmation email as a `$workflow`
 *   with per-step retry and admin visibility, replacing the
 *   fire-and-forget listeners that silently dropped a failed invoice.
 * - **checkoutReconciliation** — one delayed execution per payment
 *   handoff: a checkout still `paying` after the wait gets the PSP
 *   polled (recovering payments whose webhook never arrived — the
 *   Mollie-without-webhook case) and is settled or abandoned either way.
 *
 * Import this ALONGSIDE `@alepha/commerce/invoicing` and/or
 * `@alepha/commerce/notifications` — the settlement steps activate for
 * whichever of the two is loaded and skip cleanly otherwise. Without this
 * module, invoicing and notifications do nothing on the paid transition:
 * the paid-path side effects live here, on purpose, so they can never run
 * twice.
 *
 * @module alepha.commerce.settlement
 */
export const AlephaCommerceSettlement = $module({
  name: "alepha.commerce.settlement",
  imports: [AlephaCommerce, AlephaCommerceCheckout, AlephaApiWorkflows],
  atoms: [settlementConfig],
  services: [SettlementWorkflows, SettlementListener],
});
