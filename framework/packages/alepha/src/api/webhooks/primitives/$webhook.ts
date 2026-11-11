import type { PrimitiveSide } from "alepha";
import {
  $inject,
  createPrimitive,
  type Infer,
  Primitive,
  type ZObject,
  z,
} from "alepha";
import { KIND } from "alepha/internal";

import { webhookEnvelopeSchema } from "../schemas/webhookEnvelopeSchema.ts";
import type { WebhookSendOptions } from "../schemas/webhookSendOptionsSchema.ts";
import {
  WebhookService,
  type WebhookSendResult,
} from "../services/WebhookService.ts";

/**
 * Declares an outbound webhook event: its name, what it means to a
 * third-party developer, and the schema of its data.
 *
 * **Events are code, endpoints are data.** This declares what can be sent;
 * which URLs receive it is rows an operator manages (`webhook_endpoints`).
 * The declaration is also the documentation: the event catalog and the
 * `x-webhooks` section of the OpenAPI document are derived from every
 * `$webhook` in the container.
 *
 * `send(data)` validates the data, and for every active endpoint subscribed
 * to the event writes one delivery row and pushes one
 * `system.webhooks.deliver` job. The receiver gets a signed POST
 * (Standard Webhooks), retried for about 24 hours.
 *
 * **Semantics:** at-least-once and unordered; receivers dedup on the
 * `webhook-id` header.
 *
 * @example
 * ```ts
 * class OrderWebhooks {
 *   paid = $webhook({
 *     name: "order.paid",
 *     description: "An order was paid in full.",
 *     schema: z.object({ orderId: z.uuid(), total: z.number() }),
 *   });
 * }
 *
 * await this.webhooks.paid.send({ orderId, total });
 * ```
 */
export const $webhook = <T extends ZObject>(
  options: WebhookPrimitiveOptions<T>,
): WebhookPrimitive<T> => createPrimitive(WebhookPrimitive<T>, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface WebhookPrimitiveOptions<T extends ZObject> {
  /**
   * The event's public name, dotted and lower case (`order.paid`). Unique in
   * the container, and a contract: a receiver subscribes to it by name.
   */
  name: string;

  /**
   * One or two sentences a third-party developer reads in the catalog.
   */
  description: string;

  /**
   * The schema of the event's `data`. A key removed from it later is a
   * breaking change for every receiver; one added is not.
   */
  schema: T;
}

// ---------------------------------------------------------------------------------------------------------------------

export class WebhookPrimitive<T extends ZObject = ZObject> extends Primitive<
  WebhookPrimitiveOptions<T>
> {
  /**
   * `boot` for the pure controller rule: registers itself at init, read by OpenAPI.
   */
  public static override readonly side: PrimitiveSide = "boot";

  protected readonly webhooks = $inject(WebhookService);

  public get name(): string {
    return this.options.name;
  }

  public get description(): string {
    return this.options.description;
  }

  public get schema(): T {
    return this.options.schema;
  }

  /**
   * The JSON Schema of the event's `data`, for the event catalog.
   */
  public jsonSchema(): Record<string, unknown> {
    return this.toJson(this.schema);
  }

  /**
   * This event's entry in the OpenAPI document's `x-webhooks` section: a
   * path item with one `post`, the envelope as its JSON body (with `data`
   * this event's own schema), the three `webhook-*` headers, and a `2XX`.
   *
   * Built here, beside the envelope, so the swagger provider reads it by
   * the primitive's name and never rebuilds the envelope itself.
   */
  public openApiPathItem(): Record<string, unknown> {
    const header = (name: string, description: string) => ({
      name,
      in: "header",
      required: true,
      description,
      schema: { type: "string" },
    });
    return {
      post: {
        summary: this.name,
        description: this.description,
        parameters: [
          header(
            "webhook-id",
            "The event's id, stable across retries: deduplicate on it.",
          ),
          header(
            "webhook-timestamp",
            "When this attempt was signed, in seconds.",
          ),
          header(
            "webhook-signature",
            "Space-separated `v1,<base64>` HMAC-SHA256 signatures of `id.timestamp.body` (Standard Webhooks).",
          ),
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: this.toJson(
                webhookEnvelopeSchema.extend({ data: this.schema }),
              ),
            },
          },
        },
        responses: {
          "2XX": {
            description:
              "Received. Any other answer is retried; `410 Gone` unsubscribes the endpoint.",
          },
        },
      },
    };
  }

  protected toJson(schema: ZObject): Record<string, unknown> {
    const json = z.toJSONSchema(schema) as Record<string, unknown>;
    delete json.$schema;
    return json;
  }

  protected onInit() {
    this.webhooks.register(this as unknown as WebhookPrimitive);
  }

  /**
   * Send the event to every active endpoint subscribed to it.
   *
   * Validates `data` against the schema (a failure throws and writes
   * nothing), builds the envelope `{ id, type, timestamp, data }` with a
   * UUIDv7 id, writes one delivery row per endpoint and pushes their jobs in
   * one `pushMany`. With no subscribed endpoint it writes nothing.
   *
   * **Inside a transaction it is a true outbox** on Postgres and SQLite: the
   * delivery rows commit with your write and are delivered right after the
   * commit; a rollback sends nothing. **On D1 there is no transaction**, so
   * each write stands alone. Outside a transaction, `send` is not tied to
   * anything written before it.
   *
   * `scope` is fail-closed: without it, only unscoped endpoints receive the
   * event; with it, the unscoped ones and that scope's own.
   *
   * @example
   * ```ts
   * await this.db.transactional(async () => {
   *   const order = await this.orders.updateById(id, { status: "paid" });
   *   await this.webhooks.paid.send({ orderId: order.id, total: order.total });
   * });
   * ```
   */
  public async send(
    data: Infer<T>,
    options?: WebhookSendOptions,
  ): Promise<WebhookSendResult> {
    return this.webhooks.send(
      this as unknown as WebhookPrimitive,
      data as Record<string, unknown>,
      options,
    );
  }
}

$webhook[KIND] = WebhookPrimitive;
