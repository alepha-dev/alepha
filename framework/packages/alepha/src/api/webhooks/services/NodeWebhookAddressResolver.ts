// A namespace import, not a named one: Bun loads `node:dns` this way, and
// the module's workerd build never reaches this file.
import * as dns from "node:dns";

import { WebhookAddressResolver } from "./WebhookAddressResolver.ts";

/**
 * The Node and Bun resolver: every address of `dns.lookup(host, { all })`.
 *
 * Nothing is pinned: `fetch` resolves the name again by itself, so a
 * resolver that answers differently between this check and the request
 * (DNS rebinding) is not stopped.
 */
export class NodeWebhookAddressResolver extends WebhookAddressResolver {
  public override async resolve(host: string): Promise<string[]> {
    const answers = await dns.promises.lookup(host, { all: true });
    return answers.map((it) => it.address);
  }
}
