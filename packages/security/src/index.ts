import { __bind, type Alepha } from "@alepha/core";
import { $permission } from "./descriptors/$permission.ts";
import { $realm } from "./descriptors/$realm.ts";
import { $role } from "./descriptors/$role.ts";
import type { UserAccountInfo } from "./interfaces/UserAccountInfo.ts";
import { JwtProvider } from "./providers/JwtProvider.ts";
import { SecurityProvider } from "./providers/SecurityProvider.ts";

export * from "./descriptors/$permission.ts";
export * from "./descriptors/$realm.ts";
export * from "./descriptors/$role.ts";
export * from "./descriptors/$serviceAccount.ts";
export * from "./errors/InvalidPermissionError.ts";
export * from "./errors/SecurityError.ts";
export * from "./interfaces/UserAccountInfo.ts";
export * from "./interfaces/UserAccountToken.ts";
export * from "./providers/JwtProvider.ts";
export * from "./providers/SecurityProvider.ts";
export * from "./schemas/permissionSchema.ts";
export * from "./schemas/roleSchema.ts";

declare module "@alepha/core" {
	interface Hooks {
		"security:user:created": {
			realm: string;
			user: UserAccountInfo;
		};
	}
}

/**
 * Provides comprehensive authentication and authorization capabilities with JWT tokens, role-based access control, and user management.
 * 
 * The security module enables building secure applications using descriptors like `$realm`, `$role`, and `$permission`
 * on class properties. It offers JWT-based authentication, fine-grained permissions, service accounts, and seamless
 * integration with various authentication providers and user management systems.
 * 
 * **Key Features:**
 * - Declarative realm definition with `$realm` descriptor for user authentication
 * - Role-based access control with `$role` descriptor
 * - Fine-grained permissions with `$permission` descriptor
 * - Service account management with `$serviceAccount` descriptor
 * - JWT token generation and validation
 * - OAuth integration and external provider support
 * - User session management and security hooks
 * 
 * **Basic Usage:**
 * ```ts
 * import { Alepha, run, t } from "alepha";
 * import { AlephaSecurity, $realm, $role, $permission } from "alepha/security";
 * 
 * // Define user roles
 * const adminRole = $role({
 *   name: "admin",
 *   description: "Administrator with full access",
 * });
 * 
 * const userRole = $role({
 *   name: "user", 
 *   description: "Regular user with limited access",
 * });
 * 
 * // Define permissions
 * const readUsersPermission = $permission({
 *   name: "users:read",
 *   description: "Read user information",
 * });
 * 
 * const writeUsersPermission = $permission({
 *   name: "users:write",
 *   description: "Create and update users",
 * });
 * 
 * // Define authentication realm
 * class AuthSystem {
 *   userRealm = $realm({
 *     name: "users",
 *     roles: [adminRole, userRole],
 *     permissions: [readUsersPermission, writeUsersPermission],
 *     authenticate: async (token: string) => {
 *       // Validate user token and return user info
 *       const user = await validateUserToken(token);
 *       return {
 *         id: user.id,
 *         email: user.email,
 *         roles: user.roles,
 *         permissions: user.permissions,
 *       };
 *     },
 *   });
 * }
 * 
 * const alepha = Alepha.create()
 *   .with(AlephaSecurity)
 *   .with(AuthSystem);
 * 
 * run(alepha);
 * ```
 * 
 * **OAuth Integration:**
 * ```ts
 * import { $serviceAccount } from "alepha/security";
 * 
 * class OAuthSystem {
 *   googleAuth = $realm({
 *     name: "google-oauth",
 *     provider: "oauth",
 *     config: {
 *       clientId: process.env.GOOGLE_CLIENT_ID,
 *       clientSecret: process.env.GOOGLE_CLIENT_SECRET,
 *       redirectUri: "https://myapp.com/auth/callback",
 *       scope: ["email", "profile"],
 *     },
 *     authenticate: async (oauthToken: string) => {
 *       const userInfo = await fetchGoogleUserInfo(oauthToken);
 *       return {
 *         id: userInfo.sub,
 *         email: userInfo.email,
 *         name: userInfo.name,
 *         roles: ["user"],
 *       };
 *     },
 *   });
 * 
 *   serviceAccount = $serviceAccount({
 *     name: "api-service",
 *     permissions: ["api:read", "api:write"],
 *     secret: process.env.SERVICE_ACCOUNT_SECRET,
 *   });
 * }
 * ```
 * 
 * **Role and Permission Management:**
 * ```ts
 * class PermissionSystem {
 *   // Define hierarchical roles
 *   superAdminRole = $role({
 *     name: "super-admin",
 *     inherits: [adminRole],
 *     permissions: ["*"], // All permissions
 *   });
 * 
 *   moderatorRole = $role({
 *     name: "moderator",
 *     inherits: [userRole],
 *     permissions: ["posts:moderate", "comments:moderate"],
 *   });
 * 
 *   // Define resource-specific permissions
 *   postPermissions = [
 *     $permission({ name: "posts:create", description: "Create posts" }),
 *     $permission({ name: "posts:edit", description: "Edit posts" }),
 *     $permission({ name: "posts:delete", description: "Delete posts" }),
 *     $permission({ name: "posts:moderate", description: "Moderate posts" }),
 *   ];
 * 
 *   // Check permissions in application logic
 *   async checkUserPermission(userId: string, permission: string) {
 *     const user = await this.userRealm.getUser(userId);
 *     return user.permissions.includes(permission);
 *   }
 * }
 * ```
 * 
 * **JWT Token Management:**
 * ```ts
 * class TokenSystem {
 *   userTokens = $realm({
 *     name: "jwt-tokens",
 *     jwtConfig: {
 *       secret: process.env.JWT_SECRET,
 *       expiresIn: "24h",
 *       issuer: "myapp.com",
 *       audience: "myapp-users",
 *     },
 *     authenticate: async (jwtToken: string) => {
 *       // JWT validation is handled automatically
 *       // Return user data from token payload
 *       return jwtToken.payload;
 *     },
 *   });
 * 
 *   async generateUserToken(user: { id: string; email: string; roles: string[] }) {
 *     return await this.userTokens.generateToken({
 *       sub: user.id,
 *       email: user.email,
 *       roles: user.roles,
 *       iat: Date.now(),
 *     });
 *   }
 * }
 * ```
 * 
 * @see {@link $realm}
 * @see {@link $role}
 * @see {@link $permission}
 * @see {@link $serviceAccount}
 * @module alepha.security
 */
export class AlephaSecurity {
	public readonly name = "alepha.security";
	public readonly $services = (alepha: Alepha) =>
		alepha.with(SecurityProvider).with(JwtProvider);
}

__bind($realm, AlephaSecurity);
__bind($role, AlephaSecurity);
__bind($permission, AlephaSecurity);
