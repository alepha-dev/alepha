import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { webhookDeliveryEntity } from "../entities/webhookDeliveryEntity.ts";

/**
 * Makes a delivery's request and records its outcome. Run by the
 * `system.webhooks.deliver` job, once per attempt.
 */
export class WebhookDeliveryService {
  protected readonly log = $logger();
  protected readonly deliveries = $repository(webhookDeliveryEntity);

  /**
   * One attempt of one delivery. `attempt` is the job's own attempt number.
   */
  public async deliver(deliveryId: string, attempt: number): Promise<void> {
    const delivery = await this.deliveries.findById(deliveryId);
    if (!delivery) return;
    this.log.debug("Webhook delivery picked up", {
      deliveryId: delivery.id,
      attempt,
    });
  }
}
