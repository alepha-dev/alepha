import { z } from "alepha";
import { $logger } from "alepha/logger";

import type { OrderItemEntity } from "../entities/orderItems.ts";
import { ProductKindHandler } from "../interfaces/ProductKindHandler.ts";

/**
 * Config for a `digital` product.
 */
export const digitalConfigSchema = z.object({
  /**
   * The file a buyer collects, in `alepha/api/files`. An id and not a URL: a
   * URL in a config is one leak away from being free, and cannot be taken back
   * from anybody who has seen it.
   */
  fileId: z.uuid(),
});

/**
 * Something dematerialised — a file, a licence key, a link.
 *
 * Fulfilment touches no stock. Delivery is `@alepha/commerce/downloads`: a link
 * per paid line, in the confirmation email. Without that module this handler
 * only records that the line is ready to collect, and the application delivers.
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
