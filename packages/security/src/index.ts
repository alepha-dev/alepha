import { $module } from "@alepha/core";
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
 * @see {@link $realm}
 * @see {@link $role}
 * @see {@link $permission}
 * @module alepha.security
 */
export const AlephaSecurity = $module({
	name: "alepha.security",
	descriptors: [$realm, $role, $permission],
	services: [SecurityProvider, JwtProvider],
});
