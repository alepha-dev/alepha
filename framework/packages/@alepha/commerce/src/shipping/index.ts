import { $module } from "alepha";

import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { ShippingQuoteProvider } from "../checkout/providers/ShippingQuoteProvider.ts";
import { AdminShippingController } from "./controllers/AdminShippingController.ts";
import { TableShippingQuoteProvider } from "./providers/TableShippingQuoteProvider.ts";
import { ShippingService } from "./services/ShippingService.ts";

export * from "./controllers/AdminShippingController.ts";
export * from "./entities/shippingRates.ts";
export * from "./entities/shippingZones.ts";
export * from "./providers/TableShippingQuoteProvider.ts";
export * from "./services/ShippingService.ts";

/**
 * Zone-and-rate delivery pricing.
 *
 * A separate module because a great many consumers of this domain never ship
 * anything: a point-of-sale hands goods over the counter, a ticketing app sells
 * a QR code. Neither should carry two tables and a service it cannot use.
 *
 * Importing this module is the whole integration — it claims the checkout's
 * `ShippingQuoteProvider` slot, and delivery starts being priced. Remove the
 * import and the checkout goes back to charging nothing for delivery, with no
 * other code change.
 *
 * @module alepha.commerce.shipping
 */
export const AlephaCommerceShipping = $module({
  name: "alepha.commerce.shipping",
  imports: [AlephaCommerceCheckout],
  services: [ShippingService, AdminShippingController],
  variants: [TableShippingQuoteProvider],
  register: (alepha) => {
    alepha.with({
      provide: ShippingQuoteProvider,
      use: TableShippingQuoteProvider,
    });
  },
});
