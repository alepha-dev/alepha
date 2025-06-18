import { __bind, $inject, Alepha } from "@alepha/core";
import { $permission } from "./descriptors/$permission.ts";
import { $realm } from "./descriptors/$realm.ts";
import { $role } from "./descriptors/$role.ts";
import type { UserAccountInfo } from "./interfaces/UserAccountInfo.ts";
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

export class SecurityModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.register(SecurityProvider);
	}
}

__bind($realm, SecurityModule);
__bind($role, SecurityModule);
__bind($permission, SecurityModule);
