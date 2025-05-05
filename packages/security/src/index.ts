import { $inject, Alepha, __bind } from "@alepha/core";
import { $permission } from "./descriptors/$permission.ts";
import { $realm } from "./descriptors/$realm.ts";
import { $role } from "./descriptors/$role.ts";
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

export class SecurityModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.register(SecurityProvider);
	}
}

__bind($realm, SecurityModule);
__bind($role, SecurityModule);
__bind($permission, SecurityModule);
