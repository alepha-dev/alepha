import { $module } from "@alepha/core";
import {
  $permission,
  $realm,
  $role,
  AlephaSecurity,
  type UserAccount,
  type UserAccountToken,
} from "@alepha/security";
import { AlephaServer, type FetchOptions } from "@alepha/server";
import {
  type ServerRouteSecure,
  ServerSecurityProvider,
} from "./providers/ServerSecurityProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerSecurityProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/core" {
  interface State {
    /**
     * Real (or fake) user account, used for internal actions.
     *
     * If you define this, you assume that all actions are executed by this user by default.
     * > To force a different user, you need to pass it explicitly in the options.
     */
    "alepha.server.security.system.user"?: UserAccountToken;

    /**
     * The authenticated user account attached to the server request state.
     *
     * @internal
     */
    "alepha.server.request.user"?: UserAccount;
  }
}
declare module "@alepha/server" {
  interface ServerRequest<TConfig> {
    user?: UserAccountToken; // for all routes, user is maybe present
  }

  interface ServerActionRequest<TConfig> {
    user: UserAccountToken; // for actions, user is always present
  }

  interface ServerRoute {
    /**
     * If true, the route will be protected by the security provider.
     * All actions are secure by default, but you can disable it for specific actions.
     */
    secure?: boolean | ServerRouteSecure;
  }

  interface ClientRequestOptions extends FetchOptions {
    /**
     * Forward user from the previous request.
     * If "system", use system user. @see {ServerSecurityProvider.localSystemUser}
     * If "context", use the user from the current context (e.g. request).
     *
     * @default "system" if provided, else "context" if available.
     */
    user?: UserAccountToken | "system" | "context";
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha Server that provides security features. Based on the Alepha Security module.
 *
 * By default, all $action will be guarded by a permission check.
 *
 * @see {@link ServerSecurityProvider}
 * @module alepha.server.security
 */
export const AlephaServerSecurity = $module({
  name: "alepha.server.security",
  descriptors: [$realm, $role, $permission],
  services: [AlephaServer, AlephaSecurity, ServerSecurityProvider],
});
