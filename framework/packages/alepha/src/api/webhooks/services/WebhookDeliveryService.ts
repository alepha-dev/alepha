import { $inject, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { WebhookSigner } from "alepha/security";

import {
  type WebhookDeliveryEntity,
  webhookDeliveryEntity,
} from "../entities/webhookDeliveryEntity.ts";
import {
  type WebhookEndpointEntity,
  webhookEndpointEntity,
} from "../entities/webhookEndpointEntity.ts";
import {
  WebhookTransport,
  type WebhookTransportResponse,
} from "../transports/WebhookTransport.ts";
import { WebhookHealthService } from "./WebhookHealthService.ts";
import { WebhookSecretService } from "./WebhookSecretService.ts";

/**
 * Where one attempt of a delivery stands, as the job tells it.
 */
export interface WebhookAttempt {
  /**
   * The job's attempt number, 1-based. Restarts at 1 after a resume.
   */
  attempt: number;
  /**
   * Whether the job has no attempt left after this one.
   */
  final: boolean;
}

/**
 * Makes a delivery's request and records its outcome. Run by the
 * `system.webhooks.deliver` job, once per attempt.
 *
 * 1. A `disabled` endpoint fails the delivery without a request; a `paused`
 *    one leaves it `pending` (a resume re-pushes it).
 * 2. The body is serialised once; the same string is signed and sent.
 * 3. Every request records, on the delivery, its own attempt count, the
 *    status, a 2 KB excerpt of the answer, the duration and the error.
 * 4. A 2xx delivers. `410 Gone` fails the delivery and disables the
 *    endpoint at once. Anything else, or no answer, sets the endpoint's
 *    `failingSince` and throws, so the job retries on its curve; on the
 *    last attempt the delivery is marked `failed` first.
 * 5. A secret that does not decrypt (a changed or lost `APP_SECRET`) fails
 *    the delivery with no retry and disables the endpoint with reason
 *    `secret`: a rotation is the way back.
 */
export class WebhookDeliveryService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly signer = $inject(WebhookSigner);
  protected readonly transport = $inject(WebhookTransport);
  protected readonly secretService = $inject(WebhookSecretService);
  protected readonly health = $inject(WebhookHealthService);
  protected readonly deliveries = $repository(webhookDeliveryEntity);
  protected readonly endpoints = $repository(webhookEndpointEntity);

  public async deliver(
    deliveryId: string,
    attempt: WebhookAttempt = { attempt: 1, final: false },
  ): Promise<void> {
    const delivery = await this.deliveries.findById(deliveryId);
    if (!delivery || delivery.status !== "pending") return;
    const endpoint = await this.endpoints.findById(delivery.endpointId);
    if (!endpoint) return;

    if (endpoint.status === "disabled") {
      await this.deliveries.updateById(delivery.id, {
        status: "failed",
        error: "endpoint disabled",
      });
      return;
    }
    if (endpoint.status === "paused") {
      return;
    }

    const secrets = await this.readSecrets(endpoint);
    if (!secrets) {
      await this.health.disable(endpoint, "secret");
      await this.deliveries.updateById(delivery.id, {
        status: "failed",
        error: "secret unreadable",
      });
      await this.emitError(delivery, endpoint, delivery.attempt, true);
      return;
    }

    const body = JSON.stringify(delivery.payload);
    const headers = await this.signer.headers({
      id: delivery.eventId,
      timestamp: Math.floor(this.dateTime.nowMillis() / 1000),
      body,
      secrets,
    });
    const count = delivery.attempt + 1;
    const host = this.hostOf(endpoint.url);

    let response: WebhookTransportResponse;
    try {
      response = await this.transport.send({
        url: endpoint.url,
        headers: {
          ...headers,
          "content-type": "application/json",
          "user-agent": this.userAgent(),
        },
        body,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "network error";
      await this.failAttempt(
        delivery,
        endpoint,
        count,
        attempt.final,
        { error: message.slice(0, 1000) },
        `Webhook delivery to ${host} failed: ${message}`,
      );
      return;
    }

    const now = this.dateTime.nowISOString();
    if (response.status >= 200 && response.status < 300) {
      await this.deliveries.updateById(delivery.id, {
        status: "delivered",
        attempt: count,
        responseStatus: response.status,
        responseExcerpt: response.bodyExcerpt,
        durationMs: response.durationMs,
        deliveredAt: now,
        error: null as any,
      });
      await this.endpoints.updateById(endpoint.id, {
        lastDeliveryAt: now,
        lastSuccessAt: now,
        failingSince: null as any,
      });
      await this.alepha.events.emit("webhooks:delivery:success", {
        deliveryId: delivery.id,
        endpointId: endpoint.id,
        eventType: delivery.eventType,
        host,
        attempt: count,
      });
      return;
    }

    const failure = {
      responseStatus: response.status,
      responseExcerpt: response.bodyExcerpt,
      durationMs: response.durationMs,
      error: `answered ${response.status}`,
    };
    if (response.status === 410) {
      // The endpoint first: a reader who sees the delivery `failed` sees
      // the endpoint already disabled.
      await this.health.disable(endpoint, "gone");
      await this.recordFailure(delivery, endpoint, count, true, failure);
      return;
    }
    await this.failAttempt(
      delivery,
      endpoint,
      count,
      attempt.final,
      failure,
      `Webhook delivery to ${host} answered ${response.status}`,
    );
  }

  /**
   * A failed attempt that may be retried: recorded, then thrown so the job
   * retries on its curve. Unless the endpoint has been failing for
   * `disableAfterDays`: then it is disabled with reason `failing`, the
   * delivery is failed, and nothing is thrown, so nothing retries.
   */
  protected async failAttempt(
    delivery: WebhookDeliveryEntity,
    endpoint: WebhookEndpointEntity,
    count: number,
    final: boolean,
    outcome: Parameters<WebhookDeliveryService["recordFailure"]>[4],
    message: string,
  ): Promise<void> {
    if (this.health.failingTooLong(endpoint)) {
      await this.health.disable(endpoint, "failing");
      await this.recordFailure(delivery, endpoint, count, true, outcome);
      return;
    }
    await this.recordFailure(delivery, endpoint, count, final, outcome);
    throw new AlephaError(message);
  }

  /**
   * Record a failed attempt on the delivery and the endpoint, and emit
   * `webhooks:delivery:error`. `final` marks the delivery `failed`.
   */
  protected async recordFailure(
    delivery: WebhookDeliveryEntity,
    endpoint: WebhookEndpointEntity,
    count: number,
    final: boolean,
    outcome: {
      responseStatus?: number;
      responseExcerpt?: string;
      durationMs?: number;
      error: string;
    },
  ): Promise<void> {
    const now = this.dateTime.nowISOString();
    await this.deliveries.updateById(delivery.id, {
      attempt: count,
      responseStatus: outcome.responseStatus ?? (null as any),
      responseExcerpt: outcome.responseExcerpt ?? (null as any),
      durationMs: outcome.durationMs ?? (null as any),
      error: outcome.error,
      ...(final ? { status: "failed" as const } : {}),
    });
    await this.endpoints.updateById(endpoint.id, {
      lastDeliveryAt: now,
      ...(endpoint.failingSince ? {} : { failingSince: now }),
    });
    await this.emitError(delivery, endpoint, count, final);
  }

  protected async emitError(
    delivery: WebhookDeliveryEntity,
    endpoint: WebhookEndpointEntity,
    attempt: number,
    final: boolean,
  ): Promise<void> {
    await this.alepha.events.emit("webhooks:delivery:error", {
      deliveryId: delivery.id,
      endpointId: endpoint.id,
      eventType: delivery.eventType,
      host: this.hostOf(endpoint.url),
      attempt,
      final,
    });
  }

  /**
   * The secrets to sign with: the current one, and the previous one while
   * its overlap lasts. `undefined` when the current one does not decrypt.
   */
  protected async readSecrets(
    endpoint: WebhookEndpointEntity,
  ): Promise<string[] | undefined> {
    let current: string;
    try {
      current = await this.secretService.decrypt(endpoint.secret);
    } catch {
      return undefined;
    }
    const secrets = [current];
    if (
      endpoint.previousSecret &&
      endpoint.previousSecretExpiresAt &&
      this.dateTime.of(endpoint.previousSecretExpiresAt).valueOf() >
        this.dateTime.nowMillis()
    ) {
      try {
        secrets.push(await this.secretService.decrypt(endpoint.previousSecret));
      } catch {
        // The previous secret is a courtesy: without it, sign with the new one.
      }
    }
    return secrets;
  }

  /**
   * The host of an endpoint's URL: what logs, errors and hooks name, never
   * the URL, which can carry a token in its query string.
   */
  protected hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return "invalid-url";
    }
  }

  protected userAgent(): string {
    return `${this.alepha.env.APP_NAME ?? "alepha"} webhooks`;
  }
}
