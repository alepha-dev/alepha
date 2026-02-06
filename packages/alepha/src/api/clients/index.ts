import { $module } from "alepha";
import { AdminOAuthClientController } from "./controllers/AdminOAuthClientController.ts";
import { OAuth2Controller } from "./controllers/OAuth2Controller.ts";
import { OAuth2Service } from "./services/OAuth2Service.ts";

export * from "./controllers/AdminOAuthClientController.ts";
export * from "./controllers/OAuth2Controller.ts";
export * from "./entities/oauthClientEntity.ts";
export * from "./entities/oauthGrantEntity.ts";
export * from "./schemas/adminClientQuerySchema.ts";
export * from "./schemas/adminClientResourceSchema.ts";
export * from "./schemas/createClientBodySchema.ts";
export * from "./schemas/createClientResponseSchema.ts";
export * from "./schemas/oauth2ErrorSchema.ts";
export * from "./schemas/oauth2IntrospectionResponseSchema.ts";
export * from "./schemas/oauth2TokenRequestSchema.ts";
export * from "./schemas/oauth2TokenResponseSchema.ts";
export * from "./services/OAuth2Service.ts";

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 2 - experimental | 0.17.0 | node, bun|
 *
 * OAuth2 Authorization Server module.
 *
 * **Features:**
 * - Authorization code + PKCE (OAuth 2.1)
 * - Client credentials grant
 * - Refresh token grant
 * - Token introspection (RFC 7662)
 * - Token revocation (RFC 7009)
 * - Authorization Server metadata (RFC 8414)
 * - Protected Resource metadata (RFC 9728)
 * - MCP-compatible OAuth2 flow
 *
 * **Integration:**
 * Enable via `$realm({ features: { clients: true } })`:
 *
 * ```ts
 * class MyApp {
 *   realm = $realm({
 *     features: { clients: true },
 *     identities: { credentials: true },
 *   });
 * }
 * ```
 *
 * @module alepha.api.clients
 */
export const AlephaApiClients = $module({
  name: "alepha.api.clients",
  services: [OAuth2Service, OAuth2Controller, AdminOAuthClientController],
});
