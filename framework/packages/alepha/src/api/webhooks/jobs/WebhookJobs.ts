import { $inject, z } from "alepha";
import { $job } from "alepha/api/jobs";

import { WebhookDeliveryService } from "../services/WebhookDeliveryService.ts";
import { WebhookHealthService } from "../services/WebhookHealthService.ts";

/**
 * The jobs of the webhooks module.
 */
export class WebhookJobs {
  protected readonly delivery = $inject(WebhookDeliveryService);
  protected readonly health = $inject(WebhookHealthService);

  /**
   * The eight attempts of {@link deliver}: the first and seven retries.
   */
  public readonly maxAttempts = 8;

  /**
   * Make one delivery's request, keyed by the delivery id.
   *
   * Eight attempts under the module's full jitter: each wait is uniform in
   * `[0, c]` for c = 2 min, 8 min, 32 min, 2 h 08, 8 h 32, 18 h and 18 h, so
   * a failing delivery is retried for 24 hours on average and 48 at most.
   * `max` is named on purpose: without it the global `retryBackoffMax`
   * (30 minutes) would cap every wait and end the eight attempts within
   * four hours.
   */
  public readonly deliver = $job({
    name: "system.webhooks.deliver",
    description: "Sends one webhook delivery to its endpoint.",
    schema: z.object({ deliveryId: z.uuid() }),
    timeout: [30, "seconds"],
    retry: {
      retries: this.maxAttempts - 1,
      backoff: {
        initial: [2, "minutes"],
        factor: 4,
        max: [18, "hours"],
      },
    },
    handler: async ({ payload, attempt }) => {
      await this.delivery.deliver(payload.deliveryId, {
        attempt,
        final: attempt >= this.maxAttempts,
      });
    },
  });

  /**
   * The hourly upkeep of the log: deletes deliveries past
   * `webhookOptions.retentionDays`, clears previous secrets whose overlap
   * has expired, and fails deliveries stuck `pending` with no job left to
   * move them (a cancel from the Jobs admin, a run that died on its last
   * attempt). Bounded batches.
   */
  public readonly purgeOld = $job({
    name: "system.webhooks.purge-old",
    cron: "0 * * * *",
    description:
      "Deletes old webhook deliveries, clears expired secrets and fails stuck deliveries.",
    timeout: [60, "seconds"],
    handler: async () => {
      await this.health.purge();
    },
  });
}
