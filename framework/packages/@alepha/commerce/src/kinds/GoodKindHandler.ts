import { $inject, z } from "alepha";

import type { OrderItemEntity } from "../entities/orderItems.ts";
import { ProductKindHandler } from "../interfaces/ProductKindHandler.ts";
import type { ClaimLockKey } from "../services/ClaimLock.ts";
import { StockService } from "../services/StockService.ts";

/**
 * Config for a `good`.
 */
export const goodConfigSchema = z.object({
  /**
   * When false, the product sells without touching the ledger.
   */
  trackStock: z.boolean().optional(),
  /**
   * Below this on-hand value the admin shows a warning.
   */
  lowStockThreshold: z.integer().min(0).optional(),
});

/**
 * A tangible item handed over to the buyer. The default kind.
 *
 * Fulfilment is a stock decrement - and, for a product with
 * `trackStock: false`, nothing at all. That second case is why this is a
 * handler and not a hard-coded branch in `OrderService`.
 */
export class GoodKindHandler extends ProductKindHandler {
  public readonly kind = "good";
  public readonly configSchema = goodConfigSchema;

  protected readonly stock = $inject(StockService);

  public override tracksStock(
    config: Record<string, any> | undefined,
  ): boolean {
    return config?.trackStock !== false;
  }

  /**
   * The product's stock lock, unless the product sells without the ledger.
   */
  public lockKeys(item: OrderItemEntity): ClaimLockKey[] {
    if (!this.lineTracksStock(item)) {
      return [];
    }
    return [StockService.lockKey(item.productId, item.variantId)];
  }

  /**
   * Hold the units while the payment is in flight, so a second buyer cannot
   * reach the payment page for the same last one.
   */
  public async reserve(item: OrderItemEntity): Promise<void> {
    if (!this.lineTracksStock(item)) {
      return;
    }
    await this.stock.reserve(item.productId, item.quantity, {
      orderId: item.orderId,
      variantId: item.variantId,
    });
  }

  public async fulfil(item: OrderItemEntity): Promise<void> {
    if (!this.lineTracksStock(item)) {
      return;
    }
    await this.stock.recordSale(item.productId, item.quantity, {
      orderId: item.orderId,
      orderItemId: item.id,
      variantId: item.variantId,
    });
  }

  protected lineTracksStock(item: OrderItemEntity): boolean {
    return this.tracksStock(item.config as Record<string, any> | undefined);
  }
}
