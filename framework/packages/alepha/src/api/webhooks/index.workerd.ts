import { $module } from "alepha";

import { webhooksModuleOptions } from "./index.shared.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Cloudflare Workers build of `AlephaApiWebhooks`: there is no resolver on
 * workerd, so the destination policy keeps the default
 * `WebhookAddressResolver` and the literal rules are the whole check.
 * `node:dns` is never imported.
 *
 * @module alepha.api.webhooks
 */
export const AlephaApiWebhooks = $module(webhooksModuleOptions);
