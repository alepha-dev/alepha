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

export class AlephaSecurity {
	public readonly name = "alepha.security";
	public readonly $services = (alepha: Alepha) =>
		alepha.with(SecurityProvider).with(JwtProvider);
}

__bind($realm, AlephaSecurity);
__bind($role, AlephaSecurity);
__bind($permission, AlephaSecurity);
