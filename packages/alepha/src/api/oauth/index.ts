import { $module } from "alepha";
import { OAuthController } from "./controllers/OAuthController.ts";
import { OAuthClientService } from "./services/OAuthClientService.ts";

export {
  OAuthController,
  oauthOptions,
} from "./controllers/OAuthController.ts";
export type { OAuthClientEntity } from "./entities/oauthClientEntity.ts";
export { oauthClientEntity } from "./entities/oauthClientEntity.ts";
export { buildOpenIdConfiguration } from "./helpers/oidcMetadata.ts";
export type { RegisterClientOptions } from "./services/OAuthClientService.ts";
export { OAuthClientService } from "./services/OAuthClientService.ts";

/**
 * OAuth 2.1 authorization server module for MCP.
 *
 * **Features:**
 * - OAuth 2.1 authorization code flow with PKCE (RFC 7636)
 * - Dynamic Client Registration (RFC 7591)
 * - Authorization server metadata discovery (RFC 8414)
 * - Stateless authorization codes (short-lived signed JWTs)
 * - Single-use code enforcement
 *
 * **Integration:**
 * Register the module and configure the realm + protected resource path:
 *
 * ```ts
 * const app = Alepha.create()
 *   .with(AlephaOAuth)
 *   .set(oauthOptions, { realm: "users", resource: "/mcp" });
 * ```
 *
 * @module alepha.api.oauth
 */
export const AlephaOAuth = $module({
  name: "alepha.api.oauth",
  services: [OAuthClientService, OAuthController],
});
