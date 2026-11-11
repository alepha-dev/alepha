import { $module } from "alepha";

import { MockOidcProvider } from "./providers/MockOidcProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./MockOidcServer.ts";
export * from "./providers/MockOidcProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * A mock OpenID Connect provider, for testing an app that signs its users in
 * through an external identity provider.
 *
 * **Features:**
 * - Discovery, authorize, token, JWKS, end-session and revocation endpoints,
 *   at Keycloak's paths
 * - PKCE, client secrets and refresh tokens checked as a real provider does
 * - Claims, token lifetime and advertised endpoints chosen by the test
 * - Back-channel logout tokens, delivered to the app
 *
 * @module alepha.testing.oidc
 */
export const AlephaTestingOidc = $module({
  name: "alepha.testing.oidc",
  services: [MockOidcProvider],
});
