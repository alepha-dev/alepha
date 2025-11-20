import { $module } from "alepha";
import type { UserAccount } from "alepha/security";
import { AlephaServerCookies } from "alepha/server/cookies";
import { $auth } from "./descriptors/$auth.ts";
import { ServerAuthProvider } from "./providers/ServerAuthProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./constants/routes.ts";
export * from "./descriptors/$auth.ts";
export * from "./descriptors/$authGithub.ts";
export * from "./descriptors/$authGoogle.ts";
export * from "./providers/ServerAuthProvider.ts";
export * from "./schemas/tokenResponseSchema.ts";
export * from "./schemas/tokensSchema.ts";
export * from "./schemas/userinfoResponseSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  export interface State {
    /**
     * The authenticated user account attached to the server request state.
     *
     * @internal
     */
    "alepha.server.request.user"?: UserAccount;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Allow authentication services for server applications.
 * It provides login and logout functionalities.
 *
 * There are multiple authentication providers available (e.g., Google, GitHub).
 * You can also delegate authentication to your own OIDC/OAuth2, for example using Keycloak or Auth0.
 *
 * It's cookie-based and SSR friendly.
 *
 * @see {@link $auth}
 * @see {@link ServerAuthProvider}
 * @module alepha.server.auth
 */
export const AlephaServerAuth = $module({
  name: "alepha.server.auth",
  descriptors: [$auth],
  services: [AlephaServerCookies, ServerAuthProvider],
});
