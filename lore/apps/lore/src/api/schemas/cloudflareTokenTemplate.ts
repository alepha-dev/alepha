/**
 * The permission rows a Lore deploy token needs, in the shape Cloudflare's
 * API-token template URL takes, and the builder that turns them into a link.
 *
 * ## Why this is a module and not a method
 *
 * The list has to reach the browser: it is the "mint this token" link on the
 * estate dialog and on the drawer's replace-token block. Importing
 * `EstateCloudflareService` there would pull a `$repository` into the web
 * bundle and drag the ORM with it, so this follows `estateSlugSchema.ts` -
 * a plain module both halves import.
 *
 * ## ⚠️ It is the THIRD copy of one list, and the only guarded one
 *
 * `EstateCloudflareService.PERMISSION_PROBES` is what Lore actually checks,
 * the guide at `/lore/docs/guides-cloudflare-token` is what a person reads,
 * and this is what the link pre-fills. The day someone adds a seventh probe
 * and forgets this file, the link mints a token Lore then refuses - a worse
 * failure than today's, because the person followed our own link.
 *
 * `test/cloudflare-token-template.spec.ts` pins the pairing by probe key and
 * fails if either side gains or loses a row. That spec is the drift guard
 * `PERMISSION_PROBES`'s own JSDoc says does not exist.
 *
 * ⚠️ **The template key namespace is not the dashboard's labels.** R2 is
 * `workers_r2`, not `workers_r2_storage`. Never derive a key from a label.
 */
export interface CloudflareTokenTemplateRow {
  /**
   * The matching `PERMISSION_PROBES` key. Present so the drift spec can pair
   * the two lists by identity rather than by order.
   */
  probe: string;
  /**
   * Cloudflare's own permission-group key, as the template URL spells it.
   */
  key: string;
  type: "read" | "edit";
}

export const CLOUDFLARE_TOKEN_TEMPLATE: readonly CloudflareTokenTemplateRow[] =
  [
    { probe: "account", key: "account_settings", type: "read" },
    { probe: "workers", key: "workers_scripts", type: "edit" },
    { probe: "d1", key: "d1", type: "edit" },
    { probe: "kv", key: "workers_kv_storage", type: "edit" },
    { probe: "r2", key: "workers_r2", type: "edit" },
    { probe: "queues", key: "queues", type: "edit" },
  ];

/**
 * The name the dashboard pre-fills. Not a secret, and worth being specific:
 * a person minting several of these needs to tell them apart.
 */
export const CLOUDFLARE_TOKEN_NAME = "lore-deploy";

/**
 * A link that opens Cloudflare's Custom token form with the six rows already
 * added.
 *
 * ⚠️ **`accountId=*` pre-selects All accounts**, which is what the guide's
 * own step tells people not to leave. Cloudflare documents `*` and nothing
 * else for that parameter, and whether a real 32-hex id narrows the form has
 * NOT been tested against a live dashboard - see #Q2061's objective 0. Until
 * somebody runs that test this ships the documented value and the copy beside
 * the link says to narrow Account Resources by hand. Shipping a link that
 * claims to be scoped and is not would be worse than the tedium it replaces.
 *
 * ⚠️ **No token, ever, in a URL.** This carries permission keys and a name.
 * Nothing here is a secret and nothing here may become one: a query string
 * lands in browser history, in a referrer and in any proxy's log.
 */
export const cloudflareTokenTemplateUrl = (): string => {
  const permissions = CLOUDFLARE_TOKEN_TEMPLATE.map((row) => ({
    key: row.key,
    type: row.type,
  }));
  const query = new URLSearchParams({
    permissionGroupKeys: JSON.stringify(permissions),
    accountId: "*",
    zoneId: "all",
    name: CLOUDFLARE_TOKEN_NAME,
  });
  return `https://dash.cloudflare.com/profile/api-tokens?${query.toString()}`;
};
