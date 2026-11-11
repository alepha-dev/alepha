import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { webhookDeliveryEntity } from "../entities/webhookDeliveryEntity.ts";
import {
  type WebhookEndpointEntity,
  webhookEndpointEntity,
} from "../entities/webhookEndpointEntity.ts";
import { WebhookJobs } from "../jobs/WebhookJobs.ts";
import type { CreateWebhookEndpoint } from "../schemas/createWebhookEndpointSchema.ts";
import type { WebhookEndpointResource } from "../schemas/webhookEndpointResourceSchema.ts";
import type { WebhookEndpointWithSecret } from "../schemas/webhookEndpointWithSecretSchema.ts";
import { WebhookDestinationPolicy } from "./WebhookDestinationPolicy.ts";
import { WebhookSecretService } from "./WebhookSecretService.ts";

/**
 * The write path of webhook endpoints, and the one place their secrets are
 * generated, encrypted and decrypted.
 *
 * Every operation an admin screen or an app's own settings page drives
 * lives here, so an app offering webhooks to its customers writes a thin
 * controller of its own over it, passing its tenancy key as `scope`.
 */
export class WebhookEndpointService {
  protected readonly log = $logger();
  protected readonly secrets = $inject(WebhookSecretService);
  protected readonly policy = $inject(WebhookDestinationPolicy);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly jobs = $inject(WebhookJobs);
  protected readonly endpoints = $repository(webhookEndpointEntity);
  protected readonly deliveries = $repository(webhookDeliveryEntity);

  /**
   * Register an endpoint and return its signing secret, in clear, this once.
   *
   * The secret is `whsec_` and 32 random bytes in base64, stored encrypted
   * with `APP_SECRET`. No read ever returns it again.
   */
  public async create(
    input: CreateWebhookEndpoint & { createdBy?: string },
  ): Promise<WebhookEndpointWithSecret> {
    this.policy.checkUrl(input.url);
    const secret = this.secrets.generate();
    const row = await this.endpoints.create({
      url: input.url,
      description: input.description,
      events: this.normalizeEvents(input.events),
      scope: input.scope,
      createdBy: input.createdBy,
      secret: await this.secrets.encrypt(secret),
      secretPrefix: secret.slice(0, 10),
      status: "active",
    });
    this.log.info("Webhook endpoint created", {
      endpointId: row.id,
      host: this.hostOf(row.url),
    });
    return { endpoint: this.toResource(row), secret };
  }

  /**
   * Edit an endpoint's URL, description or events. A new URL goes through
   * the destination policy's literal rules, refused on the `url` field.
   */
  public async update(
    id: string,
    input: { url?: string; description?: string; events?: string[] },
  ): Promise<WebhookEndpointResource> {
    if (input.url !== undefined) this.policy.checkUrl(input.url);
    const row = await this.endpoints.updateById(id, {
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.events !== undefined
        ? { events: this.normalizeEvents(input.events) }
        : {}),
    });
    return this.toResource(row);
  }

  /**
   * Give an endpoint a new secret and return it, in clear, this once.
   *
   * The current secret becomes the previous one and keeps signing beside
   * the new one for 24 hours, so a receiver deploys the new secret without
   * dropping a delivery. `expireNow` drops the old secret at once, for a
   * leak. Rotating enables nothing: an endpoint disabled with reason
   * `secret` is enabled by the operator after the rotation.
   */
  public async rotateSecret(
    id: string,
    options: { expireNow?: boolean } = {},
  ): Promise<WebhookEndpointWithSecret> {
    const row = await this.endpoints.getById(id);
    const secret = this.secrets.generate();
    const keepPrevious = !options.expireNow;
    const updated = await this.endpoints.updateById(id, {
      secret: await this.secrets.encrypt(secret),
      secretPrefix: secret.slice(0, 10),
      previousSecret: keepPrevious ? row.secret : (null as any),
      previousSecretExpiresAt: keepPrevious
        ? this.dateTime.now().add(24, "hours").toISOString()
        : (null as any),
    });
    this.log.info("Webhook endpoint secret rotated", {
      endpointId: id,
      host: this.hostOf(row.url),
      expireNow: !keepPrevious,
    });
    return { endpoint: this.toResource(updated), secret };
  }

  /**
   * Set a paused endpoint back to `active` and re-push one job per delivery
   * still `pending` on it, each keyed by its delivery id and touched so the
   * stuck-delivery purge leaves it alone.
   *
   * Events sent WHILE the endpoint was paused got no delivery (only active
   * endpoints receive one) and are not replayed.
   */
  public async resume(id: string): Promise<WebhookEndpointResource> {
    const row = await this.endpoints.getById(id);
    if (row.status === "disabled") {
      throw new AlephaError(
        "A disabled webhook endpoint is enabled, not resumed",
      );
    }
    const updated = await this.endpoints.updateById(id, { status: "active" });
    const pending = await this.deliveries.findMany({
      where: { endpointId: { eq: id }, status: { eq: "pending" } },
    });
    if (pending.length > 0) {
      await this.deliveries.updateMany(
        { endpointId: { eq: id }, status: { eq: "pending" } },
        { error: null as any },
      );
      await this.jobs.deliver.pushMany(
        pending.map((it) => ({ payload: { deliveryId: it.id }, key: it.id })),
      );
    }
    this.log.info("Webhook endpoint resumed", {
      endpointId: id,
      host: this.hostOf(row.url),
      redelivering: pending.length,
    });
    return this.toResource(updated);
  }

  /**
   * The active endpoints an event of `eventType` reaches.
   *
   * **Scope is fail-closed.** Without a scope, only unscoped endpoints. With
   * one, the unscoped endpoints and the endpoints of exactly that scope. A
   * scoped endpoint therefore never receives an event sent without its
   * scope: forgetting `scope` in a multi-tenant app delivers to the
   * operator's own endpoints, never to another tenant's.
   *
   * The subscription filter runs in memory over the rows selected by status
   * and scope: array operators are Postgres-only in the ORM.
   */
  public async subscribers(
    eventType: string,
    scope?: string,
  ): Promise<WebhookEndpointEntity[]> {
    const rows = await this.endpoints.findMany({
      where: {
        status: { eq: "active" },
        ...(scope === undefined
          ? { scope: { isNull: true } }
          : { or: [{ scope: { isNull: true } }, { scope: { eq: scope } }] }),
      },
    });
    return rows.filter(
      (row) => row.events.length === 0 || row.events.includes(eventType),
    );
  }

  /**
   * An endpoint as reads return it: never a secret.
   */
  public toResource(row: WebhookEndpointEntity): WebhookEndpointResource {
    return {
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      url: row.url,
      description: row.description,
      events: row.events,
      status: row.status,
      disabledReason: row.disabledReason,
      scope: row.scope,
      createdBy: row.createdBy,
      secretPrefix: row.secretPrefix,
      hasPreviousSecret: !!row.previousSecret,
      previousSecretExpiresAt: row.previousSecretExpiresAt,
      failingSince: row.failingSince,
      lastDeliveryAt: row.lastDeliveryAt,
      lastSuccessAt: row.lastSuccessAt,
    };
  }

  /**
   * The host of an endpoint's URL: what logs, errors and hook payloads name,
   * never the URL, which can carry a token in its query string.
   */
  public hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return "invalid-url";
    }
  }

  protected normalizeEvents(events?: string[]): string[] {
    return [...new Set((events ?? []).map((it) => it.trim()).filter(Boolean))];
  }
}
