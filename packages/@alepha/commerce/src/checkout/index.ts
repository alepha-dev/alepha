import { $module } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaApiPayments } from "alepha/api/payments";
import { AlephaCommerceCart } from "../cart/index.ts";
import { AlephaCommerce } from "../index.ts";
import { CheckoutController } from "./controllers/CheckoutController.ts";
import { AddressRulesProvider } from "./providers/AddressRulesProvider.ts";
import { CheckoutPaymentProvider } from "./providers/CheckoutPaymentProvider.ts";
import { EmbeddedCheckoutPayment } from "./providers/EmbeddedCheckoutPayment.ts";
import { OrderDocumentsProvider } from "./providers/OrderDocumentsProvider.ts";
import { RedirectCheckoutPayment } from "./providers/RedirectCheckoutPayment.ts";
import {
  NoShippingQuoteProvider,
  ShippingQuoteProvider,
} from "./providers/ShippingQuoteProvider.ts";
import { AddressService } from "./services/AddressService.ts";
import { CheckoutService } from "./services/CheckoutService.ts";
import { CheckoutSettlementListener } from "./services/CheckoutSettlementListener.ts";
import { StockReservationSweeper } from "./services/StockReservationSweeper.ts";
import { TaxService } from "./services/TaxService.ts";

export * from "./controllers/CheckoutController.ts";
export * from "./entities/addresses.ts";
export * from "./entities/checkoutSessions.ts";
export * from "./providers/AddressRulesProvider.ts";
export * from "./providers/CheckoutPaymentProvider.ts";
export * from "./providers/EmbeddedCheckoutPayment.ts";
export * from "./providers/OrderDocumentsProvider.ts";
export * from "./providers/RedirectCheckoutPayment.ts";
export * from "./providers/ShippingQuoteProvider.ts";
export * from "./services/AddressService.ts";
export * from "./services/CheckoutService.ts";
export * from "./services/CheckoutSettlementListener.ts";
export * from "./services/StockReservationSweeper.ts";
export * from "./services/TaxService.ts";

declare module "alepha" {
  interface Hooks {
    /**
     * A checkout session captured (or corrected) a buyer email. Emitted
     * after the write commits; the cart-recovery module keys its
     * follow-up sequence off this.
     */
    "commerce:checkout:email": {
      sessionId: string;
      cartId: string;
      email: string;
    };

    /**
     * A checkout was handed to the payment rail: session `paying`, order
     * pending, intent created. The settlement module keys its
     * reconciliation workflow off this — the buyer may never come back.
     */
    "commerce:checkout:paying": {
      sessionId: string;
      cartId: string;
      orderId: string;
      intentId: string;
    };
  }
}

/**
 * Turns a cart into a paid order.
 *
 * Depends on the cart module and on `alepha/api/payments`, which owns the
 * intent lifecycle and the PSP adapters. Registers hosted-redirect payment by
 * default — the one handoff every PSP supports — leaving an embedded card field
 * to a substitution:
 *
 * ```ts
 * alepha.with({
 *   provide: CheckoutPaymentProvider,
 *   use: StripeElementsCheckoutPayment,
 * });
 * ```
 *
 * @module alepha.commerce.checkout
 */
export const AlephaCommerceCheckout = $module({
  name: "alepha.commerce.checkout",
  // `AlephaApiJobs` is declared explicitly: the payments module uses `$job`
  // without importing it, so relying on it transitively would be relying on
  // someone else's oversight.
  imports: [
    AlephaCommerce,
    AlephaCommerceCart,
    AlephaApiPayments,
    AlephaApiJobs,
  ],
  services: [
    CheckoutPaymentProvider,
    ShippingQuoteProvider,
    OrderDocumentsProvider,
    AddressRulesProvider,
    AddressService,
    CheckoutService,
    CheckoutSettlementListener,
    StockReservationSweeper,
    CheckoutController,
    TaxService,
  ],
  variants: [
    RedirectCheckoutPayment,
    EmbeddedCheckoutPayment,
    NoShippingQuoteProvider,
  ],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: CheckoutPaymentProvider,
      use: RedirectCheckoutPayment,
    });
    // `optional` so importing `@alepha/commerce/shipping` wins: it registers
    // its own provider, and whichever module is wired second must not clobber it.
    alepha.with({
      optional: true,
      provide: ShippingQuoteProvider,
      use: NoShippingQuoteProvider,
    });
  },
});
