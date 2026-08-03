import { $module } from "alepha";
import type { FetchOptions } from "alepha/server";
import { currentResourceAtom } from "./atoms/currentResourceAtom.ts";
import { currentTenantAtom } from "./atoms/currentTenantAtom.ts";
import { currentUserAtom } from "./atoms/currentUserAtom.ts";
import { tenancyAtom } from "./atoms/tenancyAtom.ts";
import type { UserAccountToken } from "./interfaces/UserAccountToken.ts";
import { $issuer } from "./primitives/$issuer.ts";
import { $permission } from "./primitives/$permission.ts";
import { $role } from "./primitives/$role.ts";
import { JwtProvider } from "./providers/JwtProvider.ts";
import { OwnedResourceProvider } from "./providers/OwnedResourceProvider.ts";
import { SecurityProvider } from "./providers/SecurityProvider.ts";
import { ServerSecurityProvider } from "./providers/ServerSecurityProvider.ts";
import type { UserAccount } from "./schemas/userAccountInfoSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "alepha/crypto";
export * from "./atoms/currentResourceAtom.ts";
export * from "./atoms/currentTenantAtom.ts";
export * from "./atoms/currentUserAtom.ts";
export * from "./atoms/tenancyAtom.ts";
export * from "./errors/InvalidCredentialsError.ts";
export * from "./errors/InvalidPermissionError.ts";
export * from "./errors/SecurityError.ts";
export * from "./interfaces/IssuerResolver.ts";
export * from "./interfaces/UserAccountToken.ts";
export * from "./primitives/$basicAuth.ts";
export * from "./primitives/$issuer.ts";
export * from "./primitives/$owns.ts";
export * from "./primitives/$permission.ts";
export * from "./primitives/$role.ts";
export * from "./primitives/$secure.ts";
export * from "./primitives/$serviceAccount.ts";
export * from "./providers/JwtProvider.ts";
export * from "./providers/OwnedResourceProvider.ts";
export * from "./providers/SecurityProvider.ts";
export * from "./providers/ServerSecurityProvider.ts";
export * from "./schemas/permissionSchema.ts";
export * from "./schemas/roleSchema.ts";
export * from "./schemas/userAccountInfoSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

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
    "alepha.security.system.user"?: UserAccountToken;

    /**
     * The current authenticated user.
     */
    "alepha.security.user"?: UserAccount;

    /**
     * The tenant the current request is acting in.
     *
     * Typically set by an app-level middleware from the request `Host`. When
     * present, `Repository` scoping and session creation prefer this value
     * over `currentUserAtom.organization`.
     */
    "alepha.security.tenant"?: { id: string };
  }
}

declare module "alepha/server" {
  interface ServerRequest<TConfig> {
    user?: UserAccountToken; // for all routes, user is maybe present
  }

  interface ServerActionRequest<TConfig> {
    user: UserAccountToken; // for actions, user is always present
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
  primitives: [$issuer, $role, $permission],
  atoms: [currentUserAtom, currentTenantAtom, currentResourceAtom, tenancyAtom],
  services: [
    SecurityProvider,
    JwtProvider,
    ServerSecurityProvider,
    OwnedResourceProvider,
  ],
});
