import { $module, type Alepha } from "alepha";
import { AlephaServer, type FetchOptions } from "alepha/server";
import type { UserAccountToken } from "./interfaces/UserAccountToken.ts";
import { $basicAuth } from "./primitives/$basicAuth.ts";
import { $issuer } from "./primitives/$issuer.ts";
import { $permission } from "./primitives/$permission.ts";
import { $role } from "./primitives/$role.ts";
import { CryptoProvider } from "./providers/CryptoProvider.ts";
import { JwtProvider } from "./providers/JwtProvider.ts";
import { SecurityProvider } from "./providers/SecurityProvider.ts";
import { ServerBasicAuthProvider } from "./providers/ServerBasicAuthProvider.ts";
import { ServerSecurityProvider } from "./providers/ServerSecurityProvider.ts";
import type { UserAccount } from "./schemas/userAccountInfoSchema.ts";

export * from "./errors/InvalidCredentialsError.ts";
export * from "./errors/InvalidPermissionError.ts";
export * from "./errors/SecurityError.ts";
export * from "./interfaces/IssuerResolver.ts";
export * from "./interfaces/UserAccountToken.ts";
export * from "./primitives/$basicAuth.ts";
export * from "./primitives/$issuer.ts";
export * from "./primitives/$permission.ts";
export * from "./primitives/$role.ts";
export * from "./primitives/$serviceAccount.ts";
export * from "./providers/CryptoProvider.ts";
export * from "./providers/JwtProvider.ts";
export * from "./providers/SecurityProvider.ts";
export * from "./providers/ServerBasicAuthProvider.ts";
export * from "./providers/ServerSecurityProvider.ts";
export * from "./schemas/permissionSchema.ts";
export * from "./schemas/roleSchema.ts";
export * from "./schemas/userAccountInfoSchema.ts";

import type { ServerRouteSecure } from "./providers/ServerSecurityProvider.ts";

declare module "alepha" {
  interface Hooks {
    "security:user:created": {
      realm: string;
      user: UserAccount;
    };
  }

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

declare module "alepha/server" {
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

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | backend | epic | stable |
 *
 * Complete authentication and authorization system with JWT, RBAC, and multi-issuer support.
 *
 * **Features:**
 * - JWT token issuer with role definitions
 * - Role-based access control (RBAC)
 * - Fine-grained permissions
 * - HTTP Basic Authentication
 * - Service-to-service authentication
 * - Multi-issuer support for federated auth
 * - JWKS (JSON Web Key Set) for external issuers
 * - Token refresh logic
 * - User profile extraction from JWT
 *
 * @module alepha.security
 */
export const AlephaSecurity = $module({
  name: "alepha.security",
  primitives: [$issuer, $role, $permission, $basicAuth],
  services: [
    SecurityProvider,
    JwtProvider,
    CryptoProvider,
    ServerSecurityProvider,
    ServerBasicAuthProvider,
  ],
  register: (alepha: Alepha) => {
    // Always register core security providers
    alepha.with(SecurityProvider);
    alepha.with(JwtProvider);
    alepha.with(CryptoProvider);

    // Register server security providers only if AlephaServer is available
    if (alepha.has(AlephaServer)) {
      alepha.with(ServerSecurityProvider);
      alepha.with(ServerBasicAuthProvider);
    }
  },
});

/**
 * @deprecated Use `AlephaSecurity` instead. Server security providers are automatically registered when `AlephaServer` is available.
 */
export const AlephaServerSecurity = AlephaSecurity;
