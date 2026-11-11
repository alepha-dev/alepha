import { $inject, z } from "alepha";
import {
  webhookEndpointQuerySchema,
  webhookEndpointResourceSchema,
  webhookEventResourceSchema,
} from "alepha/api/webhooks";
import { $action } from "alepha/server";

import { ShowcaseWebhooks } from "./ShowcaseWebhooks.ts";

/**
 * Stands in for `AdminWebhookController`.
 *
 * ⚠️ Property names ARE action names and must match the real controller.
 *
 * Only the two reads `<AdminWebhooks />` makes on load are declared. The
 * writes are absent rather than stubbed: a showcase that "rotated" a secret
 * would show one that signs nothing.
 */
export class ShowcaseWebhooksController {
  protected readonly webhooks = $inject(ShowcaseWebhooks);

  public readonly findWebhookEndpoints = $action({
    method: "GET",
    path: "/admin/webhooks/endpoints",
    schema: {
      query: webhookEndpointQuerySchema,
      response: z.page(webhookEndpointResourceSchema),
    },
    handler: ({ query }) => this.webhooks.paginate(query),
  });

  public readonly getWebhookEvents = $action({
    method: "GET",
    path: "/admin/webhooks/events",
    schema: { response: z.array(webhookEventResourceSchema) },
    handler: () => this.webhooks.events(),
  });
}
