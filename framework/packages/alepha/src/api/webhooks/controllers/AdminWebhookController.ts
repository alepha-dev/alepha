import { $inject, $store, Alepha, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { createWebhookEndpointSchema } from "../schemas/createWebhookEndpointSchema.ts";
import { rotateWebhookSecretSchema } from "../schemas/rotateWebhookSecretSchema.ts";
import { updateWebhookEndpointSchema } from "../schemas/updateWebhookEndpointSchema.ts";
import { webhookDeliveryDetailResourceSchema } from "../schemas/webhookDeliveryDetailResourceSchema.ts";
import { webhookDeliveryQuerySchema } from "../schemas/webhookDeliveryQuerySchema.ts";
import { webhookDeliveryRefSchema } from "../schemas/webhookDeliveryRefSchema.ts";
import { webhookDeliveryResourceSchema } from "../schemas/webhookDeliveryResourceSchema.ts";
import { webhookEndpointQuerySchema } from "../schemas/webhookEndpointQuerySchema.ts";
import { webhookEndpointResourceSchema } from "../schemas/webhookEndpointResourceSchema.ts";
import { webhookEndpointWithSecretSchema } from "../schemas/webhookEndpointWithSecretSchema.ts";
import { webhookEventResourceSchema } from "../schemas/webhookEventResourceSchema.ts";
import { webhookOptions } from "../schemas/webhookOptionsAtom.ts";
import { webhookScopeQuerySchema } from "../schemas/webhookScopeQuerySchema.ts";
import { WebhookEndpointService } from "../services/WebhookEndpointService.ts";
import { WebhookService } from "../services/WebhookService.ts";

/**
 * The webhooks admin API: endpoints, the delivery log, redeliver, the test
 * event, and the event catalog.
 *
 * Reads need `admin:webhook:read`, writes `admin:webhook:write`. Every read
 * and write takes an optional `scope` to stay within one tenant. No
 * response carries a secret, except the creation and the rotation, which
 * show it once.
 *
 * A thin layer over {@link WebhookEndpointService}, which an app's own
 * customer-facing controller uses the same way, with the customer's scope.
 */
export class AdminWebhookController {
  protected readonly url: string = "/webhooks";
  protected readonly group: string = "admin:webhooks";
  protected readonly alepha = $inject(Alepha);
  protected readonly endpoints = $inject(WebhookEndpointService);
  protected readonly webhooks = $inject(WebhookService);
  protected readonly options = $store(webhookOptions);

  protected readonly read = () =>
    $secure({ permissions: ["admin:webhook:read"] });
  protected readonly write = () =>
    $secure({ permissions: ["admin:webhook:write"] });

  // --- Endpoints ----------------------------------------------------------------------------------------------------

  public readonly findWebhookEndpoints = $action({
    method: "GET",
    path: `${this.url}/endpoints`,
    group: this.group,
    description: "Page the webhook endpoints.",
    use: [this.read()],
    schema: {
      query: webhookEndpointQuerySchema,
      response: z.page(webhookEndpointResourceSchema),
    },
    handler: ({ query }) => this.endpoints.find(query),
  });

  public readonly getWebhookEndpoint = $action({
    method: "GET",
    path: `${this.url}/endpoints/:id`,
    group: this.group,
    description: "Read one webhook endpoint.",
    use: [this.read()],
    schema: {
      params: z.object({ id: z.uuid() }),
      query: webhookScopeQuerySchema,
      response: webhookEndpointResourceSchema,
    },
    handler: ({ params, query }) =>
      this.endpoints.get(params.id, { scope: query.scope }),
  });

  public readonly createWebhookEndpoint = $action({
    method: "POST",
    path: `${this.url}/endpoints`,
    group: this.group,
    description:
      "Register a webhook endpoint. The answer carries its signing secret, shown this once.",
    use: [this.write()],
    schema: {
      body: createWebhookEndpointSchema,
      response: webhookEndpointWithSecretSchema,
    },
    handler: ({ body, user }) =>
      this.endpoints.create(body, { userId: user?.id }),
  });

  public readonly updateWebhookEndpoint = $action({
    method: "PATCH",
    path: `${this.url}/endpoints/:id`,
    group: this.group,
    description:
      "Edit a webhook endpoint, or pause and resume it. Resuming re-sends its pending deliveries.",
    use: [this.write()],
    schema: {
      params: z.object({ id: z.uuid() }),
      query: webhookScopeQuerySchema,
      body: updateWebhookEndpointSchema,
      response: webhookEndpointResourceSchema,
    },
    handler: ({ params, query, body, user }) =>
      this.endpoints.update(params.id, body, {
        scope: query.scope,
        userId: user?.id,
      }),
  });

  public readonly deleteWebhookEndpoint = $action({
    method: "DELETE",
    path: `${this.url}/endpoints/:id`,
    group: this.group,
    description: "Delete a webhook endpoint and its delivery log.",
    use: [this.write()],
    schema: {
      params: z.object({ id: z.uuid() }),
      query: webhookScopeQuerySchema,
      response: okSchema,
    },
    handler: async ({ params, query, user }) => {
      await this.endpoints.delete(params.id, {
        scope: query.scope,
        userId: user?.id,
      });
      return { ok: true };
    },
  });

  public readonly rotateWebhookEndpointSecret = $action({
    method: "POST",
    path: `${this.url}/endpoints/:id/rotate`,
    group: this.group,
    description:
      "Give a webhook endpoint a new secret, shown this once. The old one keeps signing for 24 hours unless expireNow.",
    use: [this.write()],
    schema: {
      params: z.object({ id: z.uuid() }),
      query: webhookScopeQuerySchema,
      body: rotateWebhookSecretSchema,
      response: webhookEndpointWithSecretSchema,
    },
    handler: ({ params, query, body, user }) =>
      this.endpoints.rotateSecret(params.id, body, {
        scope: query.scope,
        userId: user?.id,
      }),
  });

  public readonly enableWebhookEndpoint = $action({
    method: "POST",
    path: `${this.url}/endpoints/:id/enable`,
    group: this.group,
    description: "Enable a webhook endpoint the module disabled.",
    use: [this.write()],
    schema: {
      params: z.object({ id: z.uuid() }),
      query: webhookScopeQuerySchema,
      response: webhookEndpointResourceSchema,
    },
    handler: ({ params, query, user }) =>
      this.endpoints.enable(params.id, {
        scope: query.scope,
        userId: user?.id,
      }),
  });

  public readonly sendTestWebhook = $action({
    method: "POST",
    path: `${this.url}/endpoints/:id/test`,
    group: this.group,
    description:
      "Deliver a webhook.test event to one endpoint, whatever it subscribes to.",
    use: [this.write()],
    schema: {
      params: z.object({ id: z.uuid() }),
      query: webhookScopeQuerySchema,
      response: webhookDeliveryRefSchema,
    },
    handler: ({ params, query }) =>
      this.endpoints.sendTest(params.id, { scope: query.scope }),
  });

  // --- Deliveries ---------------------------------------------------------------------------------------------------

  public readonly findWebhookDeliveries = $action({
    method: "GET",
    path: `${this.url}/deliveries`,
    group: this.group,
    description: "Page the webhook delivery log.",
    use: [this.read()],
    schema: {
      query: webhookDeliveryQuerySchema,
      response: z.page(webhookDeliveryResourceSchema),
    },
    handler: ({ query }) => this.endpoints.findDeliveries(query),
  });

  public readonly getWebhookDelivery = $action({
    method: "GET",
    path: `${this.url}/deliveries/:id`,
    group: this.group,
    description:
      "Read one webhook delivery: the envelope sent and the receiver's answer.",
    use: [this.read()],
    schema: {
      params: z.object({ id: z.uuid() }),
      query: webhookScopeQuerySchema,
      response: webhookDeliveryDetailResourceSchema,
    },
    handler: ({ params, query }) =>
      this.endpoints.getDelivery(params.id, { scope: query.scope }),
  });

  public readonly redeliverWebhookDelivery = $action({
    method: "POST",
    path: `${this.url}/deliveries/:id/redeliver`,
    group: this.group,
    description:
      "Send a delivery again, as a new delivery with the same event id.",
    use: [this.write()],
    schema: {
      params: z.object({ id: z.uuid() }),
      query: webhookScopeQuerySchema,
      response: webhookDeliveryRefSchema,
    },
    handler: ({ params, query }) =>
      this.endpoints.redeliver(params.id, { scope: query.scope }),
  });

  // --- Catalog ------------------------------------------------------------------------------------------------------

  /**
   * Every `$webhook` in the container, with the JSON Schema of its data:
   * declared once, derived here. Public when `webhookOptions.publicCatalog`
   * is on when the controller is built.
   */
  public readonly getWebhookEvents = $action({
    method: "GET",
    path: `${this.url}/events`,
    group: this.group,
    description:
      "List the webhook events this application sends, with the JSON Schema of each event's data.",
    use: this.options.publicCatalog ? [] : [this.read()],
    schema: {
      response: z.array(webhookEventResourceSchema),
    },
    handler: () =>
      this.webhooks.list().map((it) => ({
        name: it.name,
        description: it.description,
        schema: it.jsonSchema(),
      })),
  });
}
