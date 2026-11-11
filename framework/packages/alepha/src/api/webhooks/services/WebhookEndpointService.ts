import { $inject, Alepha, type Page } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import { WebhookAudits } from "../audits/WebhookAudits.ts";
import {
  type WebhookDeliveryEntity,
  webhookDeliveryEntity,
} from "../entities/webhookDeliveryEntity.ts";
import {
  type WebhookEndpointEntity,
  webhookEndpointEntity,
} from "../entities/webhookEndpointEntity.ts";
import { WebhookEndpointNotActiveError } from "../errors/WebhookEndpointNotActiveError.ts";
import { WebhookJobs } from "../jobs/WebhookJobs.ts";
import { WebhookBuiltins } from "../primitives/WebhookBuiltins.ts";
import type { CreateWebhookEndpoint } from "../schemas/createWebhookEndpointSchema.ts";
import type { UpdateWebhookEndpoint } from "../schemas/updateWebhookEndpointSchema.ts";
import type { WebhookDeliveryDetailResource } from "../schemas/webhookDeliveryDetailResourceSchema.ts";
import type { WebhookDeliveryQuery } from "../schemas/webhookDeliveryQuerySchema.ts";
import type { WebhookDeliveryResource } from "../schemas/webhookDeliveryResourceSchema.ts";
import type { WebhookEndpointQuery } from "../schemas/webhookEndpointQuerySchema.ts";
import type { WebhookEndpointResource } from "../schemas/webhookEndpointResourceSchema.ts";
import type { WebhookEndpointWithSecret } from "../schemas/webhookEndpointWithSecretSchema.ts";
import { WebhookDestinationPolicy } from "./WebhookDestinationPolicy.ts";
import { WebhookOutbox } from "./WebhookOutbox.ts";
import { WebhookSecretService } from "./WebhookSecretService.ts";

/**
 * Who asks, and within which tenancy scope.
 *
 * `scope`, when given, limits the operation to rows of exactly that scope:
 * a row of another scope, or of none, is not found. Leave it out for the
 * operator's own admin, which sees everything.
 */
export interface WebhookAccess {
  scope?: string;
  /**
   * The acting user, recorded on the audit trail and, at creation, as the
   * endpoint's `createdBy`.
   */
  userId?: string;
}

/**
 * Every operation on webhook endpoints and their delivery log, and the one
 * place endpoint secrets are generated and encrypted.
 *
 * The admin controller is a thin layer over it, and so is the controller an
 * app writes to let its own customers manage their endpoints: pass the
 * customer's tenancy key as `scope` on every call, and nothing of another
 * tenant is ever read or written.
 *
 * @example
 * ```ts
 * class MyWebhooksController {
 *   endpoints = $inject(WebhookEndpointService);
 *
 *   list = $action({
 *     use: [$secure()],
 *     schema: {
 *       query: webhookEndpointQuerySchema,
 *       response: z.page(webhookEndpointResourceSchema),
 *     },
 *     handler: ({ query, user }) =>
 *       this.endpoints.find(query, { scope: `org:${user.organizationId}` }),
 *   });
 * }
 * ```
 */
export class WebhookEndpointService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly secrets = $inject(WebhookSecretService);
  protected readonly policy = $inject(WebhookDestinationPolicy);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly jobs = $inject(WebhookJobs);
  protected readonly outbox = $inject(WebhookOutbox);
  protected readonly audits = $inject(WebhookAudits);
  protected readonly endpoints = $repository(webhookEndpointEntity);
  protected readonly deliveries = $repository(webhookDeliveryEntity);

  // --- Endpoints ----------------------------------------------------------------------------------------------------

  /**
   * Register an endpoint and return its signing secret, in clear, this once.
   *
   * The URL goes through the destination policy (a refusal is a 400 on the
   * `url` field). The secret is `whsec_` and 32 random bytes in base64,
   * stored encrypted with `APP_SECRET`. No read ever returns it again.
   *
   * With `access.scope`, the endpoint belongs to that scope whatever
   * `input.scope` says.
   */
  public async create(
    input: CreateWebhookEndpoint & { createdBy?: string },
    access: WebhookAccess = {},
  ): Promise<WebhookEndpointWithSecret> {
    this.policy.checkUrl(input.url);
    const secret = this.secrets.generate();
    const row = await this.endpoints.create({
      url: input.url,
      description: input.description,
      events: this.normalizeEvents(input.events),
      scope: access.scope ?? input.scope,
      createdBy: input.createdBy ?? access.userId,
      secret: await this.secrets.encrypt(secret),
      secretPrefix: secret.slice(0, 10),
      status: "active",
    });
    this.log.info("Webhook endpoint created", {
      endpointId: row.id,
      host: this.hostOf(row.url),
    });
    await this.audit("create", row, access);
    return { endpoint: this.toResource(row), secret };
  }

  /**
   * Page the endpoints, newest first. `event` matches the endpoints
   * subscribed to it, the ones subscribed to every event included.
   */
  public async find(
    query: WebhookEndpointQuery = {},
    access: WebhookAccess = {},
  ): Promise<Page<WebhookEndpointResource>> {
    const scope = access.scope ?? query.scope;
    const where: Record<string, unknown> = {
      ...(query.status ? { status: { eq: query.status } } : {}),
      ...(scope !== undefined ? { scope: { eq: scope } } : {}),
      ...(query.search
        ? {
            or: [
              { url: { ilike: `%${query.search}%` } },
              { description: { ilike: `%${query.search}%` } },
            ],
          }
        : {}),
    };
    if (query.event) {
      // The subscription filter runs in memory (array operators are
      // Postgres-only), then the page is read by id.
      const event = query.event;
      const candidates = await this.endpoints.findMany({
        where: where as any,
        columns: ["id", "events"],
      });
      const ids = candidates
        .filter((it) => it.events.length === 0 || it.events.includes(event))
        .map((it) => it.id);
      where.id = ids.length > 0 ? { inArray: ids } : { isNull: true };
    }
    const page = await this.endpoints.paginate(
      { ...query, sort: query.sort ?? "-createdAt" },
      { where: where as any },
      { count: true },
    );
    return { ...page, content: page.content.map((it) => this.toResource(it)) };
  }

  public async get(
    id: string,
    access: WebhookAccess = {},
  ): Promise<WebhookEndpointResource> {
    return this.toResource(await this.row(id, access));
  }

  /**
   * Edit an endpoint's URL, description, events, or move it between
   * `active` and `paused`. A new URL goes through the destination policy;
   * going back to `active` is a {@link resume}, which re-pushes the pending
   * deliveries.
   */
  public async update(
    id: string,
    input: UpdateWebhookEndpoint,
    access: WebhookAccess = {},
  ): Promise<WebhookEndpointResource> {
    const row = await this.row(id, access);
    if (input.url !== undefined) this.policy.checkUrl(input.url);
    if (input.status !== undefined && row.status === "disabled") {
      throw new WebhookEndpointNotActiveError(
        "A disabled webhook endpoint is enabled, not resumed or paused",
      );
    }
    await this.endpoints.updateById(id, {
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.events !== undefined
        ? { events: this.normalizeEvents(input.events) }
        : {}),
      ...(input.status === "paused" ? { status: "paused" as const } : {}),
    });
    if (input.status === "active" && row.status === "paused") {
      await this.resume(id, access);
    }
    const updated = await this.endpoints.getById(id);
    await this.audit("update", updated, access, {
      changed: Object.keys(input),
    });
    return this.toResource(updated);
  }

  /**
   * Stop sending to an endpoint without disabling it: events sent while it
   * is paused get no delivery; the deliveries in flight wait for a resume.
   */
  public async pause(
    id: string,
    access: WebhookAccess = {},
  ): Promise<WebhookEndpointResource> {
    return this.update(id, { status: "paused" }, access);
  }

  /**
   * Set a paused endpoint back to `active` and re-push one job per delivery
   * still `pending` on it, each keyed by its delivery id and touched so the
   * stuck-delivery purge leaves it alone.
   *
   * Events sent WHILE the endpoint was paused got no delivery (only active
   * endpoints receive one) and are not replayed.
   */
  public async resume(
    id: string,
    access: WebhookAccess = {},
  ): Promise<WebhookEndpointResource> {
    const row = await this.row(id, access);
    if (row.status === "disabled") {
      throw new WebhookEndpointNotActiveError(
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
   * Bring back an endpoint the module disabled: `active` again, with its
   * reason and its failure run cleared. Its failed deliveries stay failed;
   * redeliver the ones that matter.
   */
  public async enable(
    id: string,
    access: WebhookAccess = {},
  ): Promise<WebhookEndpointResource> {
    await this.row(id, access);
    const updated = await this.endpoints.updateById(id, {
      status: "active",
      disabledReason: null as any,
      failingSince: null as any,
    });
    await this.audit("enable", updated, access);
    return this.toResource(updated);
  }

  /**
   * Delete an endpoint and, by cascade, its delivery log.
   */
  public async delete(id: string, access: WebhookAccess = {}): Promise<void> {
    const row = await this.row(id, access);
    await this.endpoints.deleteById(id);
    await this.audit("delete", row, access);
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
    access: WebhookAccess = {},
  ): Promise<WebhookEndpointWithSecret> {
    const row = await this.row(id, access);
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
    await this.audit("rotate", updated, access, { expireNow: !keepPrevious });
    return { endpoint: this.toResource(updated), secret };
  }

  /**
   * Deliver a `webhook.test` event to one endpoint, whatever it subscribes
   * to, and return the delivery so a screen can follow it to its outcome.
   */
  public async sendTest(
    id: string,
    access: WebhookAccess = {},
  ): Promise<{ deliveryId: string }> {
    const row = await this.row(id, access);
    this.assertActive(row);
    // Read lazily: the built-in `$webhook` registers through
    // `WebhookService`, which injects this service.
    const test = this.alepha.inject(WebhookBuiltins).test;
    const data = this.alepha.codec.validate(test.schema, {
      message: "This is a test event.",
    }) as Record<string, unknown>;
    const envelope = this.outbox.envelope(test.name, data);
    const [deliveryId] = await this.outbox.enqueueIds(envelope, [row.id]);
    return { deliveryId };
  }

  // --- Deliveries ---------------------------------------------------------------------------------------------------

  /**
   * Page the delivery log, newest first.
   */
  public async findDeliveries(
    query: WebhookDeliveryQuery = {},
    access: WebhookAccess = {},
  ): Promise<Page<WebhookDeliveryResource>> {
    const scope = access.scope ?? query.scope;
    const where: Record<string, unknown> = {
      ...(query.endpointId ? { endpointId: { eq: query.endpointId } } : {}),
      ...(query.eventType ? { eventType: { eq: query.eventType } } : {}),
      ...(query.status ? { status: { eq: query.status } } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };
    if (scope !== undefined) {
      const owned = await this.endpoints.findMany({
        where: { scope: { eq: scope } },
        columns: ["id"],
      });
      const ids = owned.map((it) => it.id);
      where.and = [
        {
          endpointId: ids.length > 0 ? { inArray: ids } : { isNull: true },
        },
      ];
    }
    const page = await this.deliveries.paginate(
      { ...query, sort: query.sort ?? "-createdAt" },
      { where: where as any },
      { count: true },
    );
    return {
      ...page,
      content: page.content.map((it) => this.toDeliveryResource(it)),
    };
  }

  /**
   * One delivery in full: the envelope sent, the answer's excerpt, and the
   * endpoint's host.
   */
  public async getDelivery(
    id: string,
    access: WebhookAccess = {},
  ): Promise<WebhookDeliveryDetailResource> {
    const { delivery, endpoint } = await this.deliveryRow(id, access);
    return {
      ...this.toDeliveryResource(delivery),
      payload: delivery.payload,
      responseExcerpt: delivery.responseExcerpt,
      host: this.hostOf(endpoint.url),
    };
  }

  /**
   * Send a delivery again: a NEW delivery row with the same envelope, and
   * so the same event id (a receiver's dedup on `webhook-id` still works),
   * and its job. The original row is never touched: the log stays a log.
   * Refused while the endpoint is not `active`.
   */
  public async redeliver(
    id: string,
    access: WebhookAccess = {},
  ): Promise<{ deliveryId: string }> {
    const { delivery, endpoint } = await this.deliveryRow(id, access);
    this.assertActive(endpoint);
    const [deliveryId] = await this.outbox.enqueueIds(delivery.payload, [
      endpoint.id,
    ]);
    return { deliveryId };
  }

  // --- Sending ------------------------------------------------------------------------------------------------------

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

  // --- Mapping ------------------------------------------------------------------------------------------------------

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

  public toDeliveryResource(
    row: WebhookDeliveryEntity,
  ): WebhookDeliveryResource {
    return {
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      endpointId: row.endpointId,
      eventType: row.eventType,
      eventId: row.eventId,
      status: row.status,
      attempt: row.attempt,
      responseStatus: row.responseStatus,
      durationMs: row.durationMs,
      deliveredAt: row.deliveredAt,
      error: row.error,
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

  // --- Internals ----------------------------------------------------------------------------------------------------

  /**
   * An endpoint row within `access.scope`, or not found.
   */
  protected async row(
    id: string,
    access: WebhookAccess,
  ): Promise<WebhookEndpointEntity> {
    const row = await this.endpoints.findById(id);
    if (!row || (access.scope !== undefined && row.scope !== access.scope)) {
      throw new NotFoundError("Webhook endpoint not found");
    }
    return row;
  }

  protected async deliveryRow(
    id: string,
    access: WebhookAccess,
  ): Promise<{
    delivery: WebhookDeliveryEntity;
    endpoint: WebhookEndpointEntity;
  }> {
    const delivery = await this.deliveries.findById(id);
    if (!delivery) throw new NotFoundError("Webhook delivery not found");
    try {
      return {
        delivery,
        endpoint: await this.row(delivery.endpointId, access),
      };
    } catch {
      throw new NotFoundError("Webhook delivery not found");
    }
  }

  protected assertActive(endpoint: WebhookEndpointEntity): void {
    if (endpoint.status !== "active") {
      throw new WebhookEndpointNotActiveError(
        `The webhook endpoint is ${endpoint.status}: resume or enable it first`,
      );
    }
  }

  protected readonly auditVerbs = {
    create: "created",
    update: "updated",
    delete: "deleted",
    rotate: "secret rotated",
    enable: "enabled",
  } as const;

  protected async audit(
    action: keyof WebhookEndpointService["auditVerbs"],
    row: WebhookEndpointEntity,
    access: WebhookAccess,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const host = this.hostOf(row.url);
    await this.audits.endpoint.log(action, {
      userId: access.userId,
      resourceType: "webhook-endpoint",
      resourceId: row.id,
      description: `Webhook endpoint to ${host} ${this.auditVerbs[action]}`,
      metadata: { host, scope: row.scope, ...metadata },
    });
  }

  protected normalizeEvents(events?: string[]): string[] {
    return [...new Set((events ?? []).map((it) => it.trim()).filter(Boolean))];
  }
}
