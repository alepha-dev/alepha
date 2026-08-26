import { $module } from "alepha";

import { OrderController } from "./controllers/OrderController.ts";
import { ProductController } from "./controllers/ProductController.ts";
import { DigitalKindHandler } from "./kinds/DigitalKindHandler.ts";
import { GoodKindHandler } from "./kinds/GoodKindHandler.ts";
import { ProductKindRegistry } from "./providers/ProductKindRegistry.ts";
import { CatalogService } from "./services/CatalogService.ts";
import { OrderService } from "./services/OrderService.ts";
import { StockService } from "./services/StockService.ts";
import { VatCalculator } from "./services/VatCalculator.ts";

export * from "./controllers/OrderController.ts";
export * from "./controllers/ProductController.ts";
export * from "./entities/orderItems.ts";
export * from "./entities/orders.ts";
export * from "./entities/products.ts";
export * from "./entities/stockMovements.ts";
export * from "./entities/stockReservations.ts";
export * from "./errors/CommerceError.ts";
export * from "./interfaces/ProductKindHandler.ts";
export * from "./kinds/DigitalKindHandler.ts";
export * from "./kinds/GoodKindHandler.ts";
export * from "./providers/ProductKindRegistry.ts";
export * from "./services/CatalogService.ts";
export * from "./services/OrderService.ts";
export * from "./services/StockService.ts";
export * from "./services/VatCalculator.ts";

declare module "alepha" {
  interface Hooks {
    /**
     * An order's payment has settled and its lines have been fulfilled.
     *
     * Emitted after the OUTERMOST transaction commits — including when
     * markPaid ran joined to a caller's transaction, as the settlement webhook
     * does — so a subscriber reads a committed order, runs while no row locks
     * are held, and cannot unwind a sale whose money is already in by
     * throwing.
     */
    "commerce:order:paid": {
      orderId: string;
      total: number;
      currency: string;
      userId?: string;
    };

    /**
     * An order has been refunded and its stock put back.
     */
    "commerce:order:refunded": {
      orderId: string;
      /**
       * The order's own total - what a full refund would come to.
       */
      total: number;
      /**
       * What THIS refund gave back.
       */
      amount: number;
      /**
       * Everything given back on the order so far, this refund included.
       * Compare it against {@link total} to tell a partial refund from the
       * one that undoes the sale; a subscriber that acts only on the latter
       * (a credit note, for instance) has to make that check.
       */
      refundedTotal: number;
      currency: string;
    };

    /**
     * An order has been handed to a carrier.
     */
    "commerce:order:shipped": {
      orderId: string;
      trackingNumber?: string;
      trackingUrl?: string;
    };

    /**
     * An unpaid order was cancelled and its holds released.
     */
    "commerce:order:cancelled": {
      orderId: string;
    };

    /**
     * Money arrived for an order that was no longer taking it.
     *
     * A PSP intent outlives the checkout session it was created for, so a
     * capture can land after the session was abandoned. The order is left as
     * it was - settling it would sell stock that has already been released -
     * and this is emitted so the application can refund or review.
     *
     * **Nobody is refunded automatically.** Whether a stray capture is
     * refunded, kept as credit or escalated is a business decision this
     * package cannot make, so it reports rather than acts.
     */
    "commerce:capture:stray": {
      orderId: string;
      /**
       * The order's status at the moment the capture arrived.
       */
      orderStatus: string;
      paymentIntentId?: string;
      total: number;
      currency: string;
    };
  }
}

/**
 * Headless commerce core: catalog, orders, stock ledger.
 *
 * Ships two product kinds — `good` (stock-tracked) and `digital` — and the
 * registry that lets any other module add more without editing this package.
 * Cart and checkout are separate modules (`@alepha/commerce/cart`,
 * `@alepha/commerce/checkout`) so a consumer that has no use for them, such as
 * a point-of-sale, does not carry their tables.
 *
 * @module alepha.commerce
 */
export const AlephaCommerce = $module({
  name: "alepha.commerce",
  services: [
    ProductKindRegistry,
    CatalogService,
    OrderService,
    StockService,
    // Core, not invoicing: a receipt needs this arithmetic and never issues an
    // invoice. See the note on the class.
    VatCalculator,
    ProductController,
    OrderController,
  ],
  // Handlers are not auto-injected: `register` below resolves them explicitly
  // so they land in the registry in a defined order.
  variants: [GoodKindHandler, DigitalKindHandler],
  register: (alepha) => {
    const registry = alepha.inject(ProductKindRegistry);
    registry.add(alepha.inject(GoodKindHandler));
    registry.add(alepha.inject(DigitalKindHandler));
  },
});
