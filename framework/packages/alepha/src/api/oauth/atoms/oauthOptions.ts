import { $atom, z } from "alepha";

import { oauthScopeSchema } from "../schemas/oauthScopeSchema.ts";

/**
 * Configuration for the OAuth authorization server.
 * `realm` is the issuer realm whose JWTs are minted as access tokens;
 * `resource` is the path of the protected MCP endpoint;
 * `loginPath` is the app-level login page unauthenticated users are
 * redirected to from the authorize endpoint.
 */
export const oauthOptions = $atom({
  name: "alepha.api.oauth.options",
  description: "Configuration for the OAuth authorization server.",
  schema: z.object({
    realm: z.text({ default: "users" }),
    resource: z.text({ default: "/mcp" }),
    loginPath: z.text({ default: "/login" }),
    /**
     * Page where a human approves a device authorization (RFC 8628). Handed to
     * the device as `verification_uri` so it can print it.
     *
     * Defaults to `/oauth/device`, which this controller serves. Point it
     * elsewhere only to hand the step to a page of the app's own; the built-in
     * one stays mounted either way.
     *
     * ⚠️ It defaulted to `/device` until #Q2217, a page nothing served: every
     * code a device printed led to a 404 and could never be approved. The
     * built-in page lives under `/oauth/` rather than at `/device` because a
     * root segment claimed by a module is claimed in every app that mounts
     * it - in Lore, a root segment is also a project slug.
     *
     * Optional so adding it does not break every existing caller of
     * `alepha.set(oauthOptions, ...)`: the sibling fields are required, and any
     * app already configuring them would stop compiling.
     */
    devicePath: z.text({ default: "/oauth/device" }).optional(),
    /**
     * The app's own name, shown on the consent screen as the party being
     * connected to ("Claude wants access to your Lore account").
     *
     * ⚠️ Deliberately NOT defaulted to `APP_NAME`. That variable is a log
     * prefix - Lore sets it to `RDM` - so falling back to it would put an
     * initialism where a product name goes, on the one page a third party
     * sees. Unset means the screen omits the identity rather than inventing
     * one.
     */
    productName: z.text().optional(),
    /**
     * Where a user revokes a granted connection, linked from the consent
     * screen.
     *
     * Defaults to `/?account=connections`, which opens the Connected apps
     * section of `@alepha/ui`'s account dialog over the home page. An app
     * that lists connections elsewhere names its own path; one that offers no
     * such page sets an empty string, and the screen omits the link.
     */
    connectionsPath: z.text().optional(),
    /**
     * What each scope MEANS, keyed by scope identifier: its consent copy, and
     * the `permissions` a token granted it may use (see `oauthScopeSchema`).
     *
     * A scope id is a wire token, and printing it at somebody about to grant
     * it tells them nothing - Lore's screen listed one bullet reading `mcp`.
     * Only the app knows what its own scopes reach, so the copy is declared
     * here rather than shipped with the framework. An undeclared scope falls
     * back to its raw identifier, which is what the screen did for all of
     * them before, and leaves any grant containing it unrestricted.
     */
    scopes: z.record(z.string(), oauthScopeSchema).optional(),
    /**
     * Accept Client ID Metadata Documents: a `client_id` that is an https
     * URL is fetched and its document registers the client, as MCP
     * 2026-07-28 prefers over dynamic registration. On by default, since
     * DCR is already open to anyone; `false` turns it off.
     */
    clientIdMetadataDocuments: z.boolean().optional(),
  }),
  default: {
    realm: "users",
    resource: "/mcp",
    loginPath: "/login",
    devicePath: "/oauth/device",
  },
  serverOnly: true,
});
