import { $module } from "alepha";

import { webhooksModuleOptions } from "./index.shared.ts";
import { NodeWebhookAddressResolver } from "./services/NodeWebhookAddressResolver.ts";
import { WebhookAddressResolver } from "./services/WebhookAddressResolver.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export * from "./services/NodeWebhookAddressResolver.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Outbound webhooks: signed, retried deliveries on the jobs outbox.
 *
 * **Features:**
 * - `$webhook` declares an event (name, description, schema); `send`
 *   writes one delivery per subscribed endpoint and pushes its job
 * - Endpoints are rows (`webhook_endpoints`), never source: URL, subscribed
 *   events, a secret encrypted with `APP_SECRET`, an optional tenancy
 *   `scope`
 * - A delivery log (`webhook_deliveries`): the envelope, the receiver's
 *   status and an excerpt of its answer, per delivery
 * - Inside a transaction, `send` is a true outbox on Postgres and SQLite
 *
 * Not registered, nothing exists: no table, no job, no route.
 *
 * @module alepha.api.webhooks
 */
export const AlephaApiWebhooks = $module({
  ...webhooksModuleOptions,
  variants: [...webhooksModuleOptions.variants, NodeWebhookAddressResolver],
  register: (alepha) => {
    webhooksModuleOptions.register(alepha);
    // Node and Bun resolve the host before each delivery, so a public name
    // pointing at a private address is refused.
    alepha.with({
      optional: true,
      provide: WebhookAddressResolver,
      use: NodeWebhookAddressResolver,
    });
  },
});
