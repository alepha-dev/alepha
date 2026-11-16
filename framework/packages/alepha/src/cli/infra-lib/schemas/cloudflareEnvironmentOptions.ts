import { type Infer, z } from "alepha";

import { environmentOptionsSchema } from "./environmentOptions.ts";

/**
 * What `cloudflare()` takes: the shared `domain`, plus the account, the data
 * jurisdiction and the Worker-to-worker bindings.
 */
export const cloudflareEnvironmentOptionsSchema =
  environmentOptionsSchema.extend({
    /**
     * Worker-to-worker service bindings, e.g.
     * `[{ binding: "ACME", service: "acme-staging" }]`.
     *
     * Exposed on the runtime `env` (Alepha store key `cloudflare.env`).
     * Use a binding to fetch() a sibling Worker on the same zone: plain
     * subrequests to a host served by a same-zone Worker route bypass the
     * route and 522.
     */
    services: z
      .array(
        z.object({
          binding: z.text(),
          service: z.text(),
        }),
      )
      .optional(),
    /**
     * Cloudflare data jurisdiction for R2 buckets, D1 databases, KV
     * namespaces and queues.
     * - "eu": data stays within the EU
     * - "us": data stays within the United States
     * - "fedramp": FedRAMP-authorized regions
     *
     * Under a jurisdiction the KV namespace and queue names carry it as a
     * suffix (`<name>-eu`), since a jurisdiction is fixed at creation and a
     * global resource of the old name must never be reused.
     *
     * Omit for the default (global) jurisdiction.
     */
    jurisdiction: z.enum(["eu", "us", "fedramp"]).optional(),
    /**
     * Cloudflare account ID to deploy into.
     *
     * Falls back to `CLOUDFLARE_ACCOUNT_ID` env var, then to the
     * token's account when the token is scoped to exactly one.
     * Required when the token has access to multiple accounts.
     */
    accountId: z.text().optional(),
    /**
     * More hosts the same Worker answers on, each attached as its own Custom
     * Domain beside `domain`, e.g. the old address of an app that moved:
     * `cloudflare({ domain: "app.example.com", aliases: ["app.example.dev"] })`.
     *
     * `domain` stays the app's address: `PUBLIC_URL` follows it, never an
     * alias. A deploy attaches every host it names and detaches none, so an
     * alias taken out of the list stays attached until it is removed from the
     * Worker's Domains & Routes by hand.
     *
     * Plain hosts only, and only beside a `domain`.
     */
    aliases: z
      .array(
        z.text().refine((it) => !it.includes("*"), {
          message:
            "A wildcard alias is refused: a Cloudflare Custom Domain cannot be one. Use a plain host.",
        }),
      )
      .optional(),
  });

export type CloudflareEnvironmentOptions = Infer<
  typeof cloudflareEnvironmentOptionsSchema
>;
