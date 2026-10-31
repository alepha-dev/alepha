import { $module } from "alepha";

import { CategoryController } from "./controllers/CategoryController.ts";
import { OrderController } from "./controllers/OrderController.ts";
import { ProductController } from "./controllers/ProductController.ts";
import { DigitalKindHandler } from "./kinds/DigitalKindHandler.ts";
import { GoodKindHandler } from "./kinds/GoodKindHandler.ts";
import { orderConfig } from "./orderConfigAtom.ts";
import { OrderDownloadsProvider } from "./providers/OrderDownloadsProvider.ts";
import { ProductKindRegistry } from "./providers/ProductKindRegistry.ts";
import { CatalogService } from "./services/CatalogService.ts";
import { CategoryService } from "./services/CategoryService.ts";
import { ClaimLock } from "./services/ClaimLock.ts";
import { LineConfigService } from "./services/LineConfigService.ts";
import { OrderService } from "./services/OrderService.ts";
import { ResourceService } from "./services/ResourceService.ts";
import { ReturnService } from "./services/ReturnService.ts";
import { StockService } from "./services/StockService.ts";
import { VariantService } from "./services/VariantService.ts";
import { VatCalculator } from "./services/VatCalculator.ts";

export * from "./controllers/CategoryController.ts";
export * from "./controllers/OrderController.ts";
export * from "./controllers/ProductController.ts";
export * from "./entities/categories.ts";
export * from "./entities/orderItems.ts";
export * from "./entities/orderRefunds.ts";
export * from "./entities/orderReturns.ts";
export * from "./entities/orders.ts";
export * from "./schemas/optionGroupSchema.ts";
export * from "./schemas/orderReturnStatusSchema.ts";
export * from "./schemas/orderStatusSchema.ts";
export * from "./schemas/publicCategorySchema.ts";
export * from "./schemas/publicOrderItemSchema.ts";
export * from "./schemas/publicOrderSchema.ts";
export * from "./schemas/publicReturnSchema.ts";
export * from "./schemas/publicVariantSchema.ts";
export * from "./entities/products.ts";
export * from "./entities/productVariants.ts";
export * from "./entities/resourceReservations.ts";
export * from "./entities/stockMovements.ts";
export * from "./entities/stockReservations.ts";
export * from "./errors/CommerceError.ts";
export * from "./interfaces/ProductKindHandler.ts";
export * from "./kinds/DigitalKindHandler.ts";
export * from "./kinds/GoodKindHandler.ts";
export * from "./kinds/ResourceKindHandler.ts";
export * from "./orderConfigAtom.ts";
export * from "./providers/OrderDownloadsProvider.ts";
export * from "./providers/ProductKindRegistry.ts";
export * from "./services/CatalogService.ts";
export * from "./services/CategoryService.ts";
export * from "./services/ClaimLock.ts";
export * from "./services/LineConfigService.ts";
export * from "./services/OrderService.ts";
export * from "./services/ResourceService.ts";
export * from "./services/ReturnService.ts";
export * from "./services/StockService.ts";
export * from "./services/VariantService.ts";
export * from "./services/VatCalculator.ts";

declare module "alepha" {
  interface Hooks {
    /**
     * An order's payment has settled and its lines have been fulfilled.
     *
     * Emitted after the OUTERMOST transaction commits - including when
     * markPaid ran joined to a caller's transaction, as the settlement webhook
     * does - so a subscriber reads a committed order, runs while no row locks
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
     * An order has been refunded, in part or in full. Its stock went back only
     * if it was a full refund of an order that never shipped.
     */
    "commerce:order:refunded": {
      orderId: string;
      /**
       * The `commerce_order_refunds` row: what came back, and why.
       */
      refundId: string;
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
       * one that undoes the sale.
       */
      refundedTotal: number;
      currency: string;
    };

    /**
     * A customer asked to send part of an order back. The parcel is on its way
     * or about to be: this is the moment to tell them where to send it.
     */
    "commerce:return:requested": {
      returnId: string;
      orderId: string;
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
    "commerce:capture:strayDetected": {
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
 * Headless commerce core: catalog, orders, and two inventory ledgers.
 *
 * - **Fungible stock** (`StockService`): a quantity on a product, sold by the
 *   `good` kind.
 * - **Interval claims on named resources** (`ResourceService`): a court, a
 *   seat on a leg, a room on a night, sold by an application's subclass of
 *   `ResourceKindHandler`.
 *
 * Ships two product kinds - `good` (stock-tracked) and `digital` - and the
 * registry that lets any other module add more without editing this package.
 * Cart and checkout are separate modules (`@alepha/commerce/cart`,
 * `@alepha/commerce/checkout`) so a consumer that has no use for them, such as
 * a point-of-sale, does not carry their tables.
 *
 * @module alepha.commerce
 */
export const AlephaCommerce = $module({
  name: "alepha.commerce",
  atoms: [orderConfig],
  services: [
    ProductKindRegistry,
    OrderDownloadsProvider,
    CategoryService,
    CatalogService,
    LineConfigService,
    OrderService,
    ReturnService,
    ClaimLock,
    StockService,
    VariantService,
    ResourceService,
    // Core, not invoicing: a receipt needs this arithmetic and never issues an
    // invoice. See the note on the class.
    VatCalculator,
    ProductController,
    CategoryController,
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
