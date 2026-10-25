import { z } from "alepha";
import { $logger } from "alepha/logger";

import type { OrderItemEntity } from "../entities/orderItems.ts";
import { ProductKindHandler } from "../interfaces/ProductKindHandler.ts";

/**
 * Config for a `digital` product.
 */
export const digitalConfigSchema = z.object({
  /**
   * Where the buyer collects the goods.
   */
  downloadUrl: z.text({ minLength: 1 }),
});

/**
 * Something dematerialised — a file, a licence key, a link.
 *
 * Fulfilment touches no stock. Delivery itself is left to the consumer: this
 * handler only records that the line is ready to collect, because *how* the
 * link reaches the buyer (order email, account page, both) is an application
 * decision and not a property of the product.
 */
export class DigitalKindHandler extends ProductKindHandler {
  public readonly kind = "digital";
  public readonly configSchema = digitalConfigSchema;

  protected readonly log = $logger();

  public async fulfil(item: OrderItemEntity): Promise<void> {
    this.log.debug("Digital line ready to collect", {
      orderId: item.orderId,
      itemId: item.id,
    });
  }
}
