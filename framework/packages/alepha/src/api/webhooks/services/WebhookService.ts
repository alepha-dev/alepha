import { $inject, $store, Alepha, AlephaError } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { webhookDeliveryEntity } from "../entities/webhookDeliveryEntity.ts";
import { WebhookPayloadTooLargeError } from "../errors/WebhookPayloadTooLargeError.ts";
import { WebhookJobs } from "../jobs/WebhookJobs.ts";
import type { WebhookPrimitive } from "../primitives/$webhook.ts";
import type { WebhookEnvelope } from "../schemas/webhookEnvelopeSchema.ts";
import { webhookOptions } from "../schemas/webhookOptionsAtom.ts";
import type { WebhookSendOptions } from "../schemas/webhookSendOptionsSchema.ts";
import { WebhookEndpointService } from "./WebhookEndpointService.ts";

/**
 * What `send` did: how many deliveries it wrote, and the event's id (the
 * `webhook-id` every receiver will see).
 */
export interface WebhookSendResult {
  eventId: string;
  deliveries: number;
}

/**
 * The registry of `$webhook` events, and the send path every one of them
 * goes through.
 */
export class WebhookService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly endpoints = $inject(WebhookEndpointService);
  protected readonly jobs = $inject(WebhookJobs);
  protected readonly deliveries = $repository(webhookDeliveryEntity);
  protected readonly options = $store(webhookOptions);

  /**
   * The shape every event name has: dotted, lower-case kebab segments, at
   * least two (`order.paid`, `return.requested`).
   */
  public readonly namePattern =
    /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/;

  protected readonly events = new Map<string, WebhookPrimitive>();

  /**
   * Register a `$webhook`. Refuses a malformed name and a duplicate one: an
   * event name is a contract receivers subscribe to.
   */
  public register(webhook: WebhookPrimitive): void {
    const name = webhook.name;
    if (typeof name !== "string" || !this.namePattern.test(name)) {
      throw new AlephaError(
        `Webhook name '${name}' does not follow the convention: dotted lower-case kebab-case segments, at least two (${this.namePattern.source}). For example 'order.paid'.`,
      );
    }
    if (this.events.has(name)) {
      throw new AlephaError(`Webhook already registered: ${name}`);
    }
    const description =
      typeof webhook.description === "string" ? webhook.description.trim() : "";
    if (description.length === 0) {
      throw new AlephaError(
        `Webhook '${name}' declares no description. Say what the event means, for the developers who receive it.`,
      );
    }
    this.events.set(name, webhook);
  }

  /**
   * Every registered event, in registration order.
   */
  public list(): WebhookPrimitive[] {
    return [...this.events.values()];
  }

  public get(name: string): WebhookPrimitive | undefined {
    return this.events.get(name);
  }

  /**
   * Validate the data, build the envelope, and write one delivery row and
   * push one keyed job per subscribed active endpoint. See
   * `WebhookPrimitive.send`.
   */
  public async send(
    webhook: WebhookPrimitive,
    data: Record<string, unknown>,
    options?: WebhookSendOptions,
  ): Promise<WebhookSendResult> {
    const validated = this.alepha.codec.validate(
      webhook.schema,
      data,
    ) as Record<string, unknown>;
    const envelope = this.envelope(webhook.name, validated);
    const bytes = new TextEncoder().encode(JSON.stringify(envelope)).byteLength;
    if (bytes > this.options.maxPayloadBytes) {
      throw new WebhookPayloadTooLargeError({
        bytes,
        limit: this.options.maxPayloadBytes,
      });
    }
    const targets = await this.endpoints.subscribers(
      webhook.name,
      options?.scope,
    );
    if (targets.length === 0) {
      return { eventId: envelope.id, deliveries: 0 };
    }
    return {
      eventId: envelope.id,
      deliveries: await this.enqueue(
        envelope,
        targets.map((it) => it.id),
      ),
    };
  }

  /**
   * Write one `pending` delivery per endpoint for `envelope` and push their
   * jobs in one `pushMany`, each keyed by its delivery id. Inside a
   * transaction both join it, and the jobs are dispatched after the commit.
   */
  public async enqueue(
    envelope: WebhookEnvelope,
    endpointIds: string[],
  ): Promise<number> {
    if (endpointIds.length === 0) return 0;
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
    return rows.length;
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
