import { $module } from "alepha";
import { AlephaServerCookies } from "alepha/server/cookies";

import { $auth } from "./primitives/$auth.ts";
import { ServerAuthProvider } from "./providers/ServerAuthProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./helpers/appleClientSecret.ts";
export * from "./index.shared.ts";
export * from "./primitives/$auth.ts";
export * from "./primitives/$authApple.ts";
export * from "./primitives/$authCredentials.ts";
export * from "./primitives/$authFacebook.ts";
export * from "./primitives/$authFranceConnect.ts";
export * from "./primitives/$authGithub.ts";
export * from "./primitives/$authGoogle.ts";
export * from "./primitives/$authMicrosoft.ts";
export * from "./providers/ServerAuthProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * OAuth2/OIDC authentication with social login providers.
 *
 * **Features:**
 * - OAuth authentication provider
 * - Username/password authentication
 * - Google OAuth integration
 * - GitHub OAuth integration
 * - Apple OAuth integration
 * - Facebook OAuth integration
 * - Microsoft Entra ID (Azure AD) integration
 * - France Connect integration
 * - Cookie-based, SSR-friendly authentication
 * - Token management and refresh
 *
 * @module alepha.server.auth
 */
export const AlephaServerAuth = $module({
  name: "alepha.server.auth",
  primitives: [$auth],
  services: [AlephaServerCookies, ServerAuthProvider],
});
