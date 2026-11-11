import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { webhookDeliveryEntity } from "../entities/webhookDeliveryEntity.ts";
import { WebhookJobs } from "../jobs/WebhookJobs.ts";
import type { WebhookEnvelope } from "../schemas/webhookEnvelopeSchema.ts";

/**
 * The write side of the delivery log: builds envelopes, writes delivery rows
 * and pushes their jobs. Shared by `send`, a redelivery and the test event.
 */
export class WebhookOutbox {
  protected readonly log = $logger();
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly jobs = $inject(WebhookJobs);
  protected readonly deliveries = $repository(webhookDeliveryEntity);

  /**
   * Write one `pending` delivery per endpoint for `envelope` and push their
   * jobs in one `pushMany`, each keyed by its delivery id. Inside a
   * transaction both join it, and the jobs are dispatched after the commit.
   */
  public async enqueue(
    envelope: WebhookEnvelope,
    endpointIds: string[],
  ): Promise<number> {
    return (await this.enqueueIds(envelope, endpointIds)).length;
  }

  /**
   * {@link enqueue}, returning the ids of the deliveries written, in the
   * order of `endpointIds`.
   */
  public async enqueueIds(
    envelope: WebhookEnvelope,
    endpointIds: string[],
  ): Promise<string[]> {
    if (endpointIds.length === 0) return [];
    const rows = await this.deliveries.createMany(
      endpointIds.map((endpointId) => ({
        endpointId,
        eventType: envelope.type,
        eventId: envelope.id,
        payload: envelope,
        status: "pending" as const,
        attempt: 0,
      })),
    );
    await this.jobs.deliver.pushMany(
      rows.map((row) => ({ payload: { deliveryId: row.id }, key: row.id })),
    );
    this.log.debug("Webhook event queued", {
      eventType: envelope.type,
      eventId: envelope.id,
      deliveries: rows.length,
    });
    return rows.map((row) => row.id);
  }

  /**
   * The envelope every receiver gets: a UUIDv7 id (the `webhook-id`), the
   * event type, the time from `DateTimeProvider`, and the data.
   */
  public envelope(
    type: string,
    data: Record<string, unknown>,
  ): WebhookEnvelope {
    return {
      id: this.crypto.randomUUIDv7(this.dateTime.nowMillis()),
      type,
      timestamp: this.dateTime.now().toISOString(),
      data,
    };
  }
}
