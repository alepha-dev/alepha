import { $module } from "alepha";
import { $issuer } from "./primitives/$issuer.ts";
import { $permission } from "./primitives/$permission.ts";
import { $role } from "./primitives/$role.ts";
import { CryptoProvider } from "./providers/CryptoProvider.ts";
import { JwtProvider } from "./providers/JwtProvider.ts";
import { SecurityProvider } from "./providers/SecurityProvider.ts";
import type { UserAccount } from "./schemas/userAccountInfoSchema.ts";

export * from "./errors/InvalidCredentialsError.ts";
export * from "./errors/InvalidPermissionError.ts";
export * from "./errors/SecurityError.ts";
export * from "./interfaces/UserAccountToken.ts";
export * from "./primitives/$issuer.ts";
export * from "./primitives/$permission.ts";
export * from "./primitives/$role.ts";
export * from "./primitives/$serviceAccount.ts";
export * from "./providers/CryptoProvider.ts";
export * from "./providers/JwtProvider.ts";
export * from "./providers/SecurityProvider.ts";
export * from "./schemas/permissionSchema.ts";
export * from "./schemas/roleSchema.ts";
export * from "./schemas/userAccountInfoSchema.ts";

declare module "alepha" {
  interface Hooks {
    "security:user:created": {
      realm: string;
      user: UserAccount;
    };
  }
}

/**
 * Provides comprehensive authentication and authorization capabilities with JWT tokens, role-based access control, and user management.
 *
 * The security module enables building secure applications using primitives like `$issuer`, `$role`, and `$permission`
 * on class properties. It offers JWT-based authentication, fine-grained permissions, service accounts, and seamless
 * integration with various authentication providers and user management systems.
 *
 * @see {@link $issuer}
 * @see {@link $role}
 * @see {@link $permission}
 * @module alepha.security
 */
export const AlephaSecurity = $module({
  name: "alepha.security",
  primitives: [$issuer, $role, $permission],
  services: [SecurityProvider, JwtProvider, CryptoProvider],
});
