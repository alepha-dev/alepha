import {
  type OrderItemEntity,
  ProductKindHandler,
  StockService,
} from "@alepha/commerce";
import { $inject, z } from "alepha";
import { $logger } from "alepha/logger";
import { WorkshopQueue } from "./WorkshopQueue.ts";

/**
 * Config for an engraved piece.
 */
export const engravedConfigSchema = z.object({
  /** Longest inscription the workshop can fit on this piece. */
  maxCharacters: z.integer().min(1).max(60),
  /** Working days added to the dispatch estimate. */
  extraLeadDays: z.integer().min(0).max(30),
});

/**
 * A piece engraved to order.
 *
 * Defined **in the application**, not in `@alepha/commerce` — which is the whole
 * point of the registry. A jeweller's made-to-order engraving has no business
 * in a framework package, and the framework does not need to know it exists.
 *
 * Fulfilment still decrements stock (the blank is a real object taken from a
 * drawer) but also raises a workshop task, which is the part no generic `good`
 * could express.
 */
export class EngravedKindHandler extends ProductKindHandler {
  public readonly kind = "engraved";
  public readonly configSchema = engravedConfigSchema;

  protected readonly log = $logger();
  protected readonly stock = $inject(StockService);
  protected readonly workshop = $inject(WorkshopQueue);

  public async fulfil(item: OrderItemEntity): Promise<void> {
    await this.stock.recordSale(item.productId, item.quantity, {
      orderId: item.orderId,
    });

    const config = item.config as { extraLeadDays: number };
    this.workshop.enqueue({
      orderId: item.orderId,
      itemId: item.id,
      leadDays: config.extraLeadDays,
    });

    this.log.info("Engraving queued", {
      orderId: item.orderId,
      leadDays: config.extraLeadDays,
    });
  }
}
