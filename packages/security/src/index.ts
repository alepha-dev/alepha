import { $inject, Alepha, autoInject } from "@alepha/core";
import { $permission } from "./descriptors/$permission";
import { $realm } from "./descriptors/$realm";
import { $role } from "./descriptors/$role";
import { SecurityProvider } from "./providers/SecurityProvider";

export * from "./descriptors/$permission";
export * from "./descriptors/$realm";
export * from "./descriptors/$role";
export * from "./descriptors/$serviceAccount";
export * from "./errors/InvalidPermissionError";
export * from "./errors/SecurityError";
export * from "./interfaces/UserAccountInfo";
export * from "./interfaces/UserAccountToken";
export * from "./providers/JwtProvider";
export * from "./providers/SecurityProvider";
export * from "./schemas/permissionSchema";
export * from "./schemas/roleSchema";

export class SecurityModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.register(SecurityProvider);
	}
}

autoInject($realm, SecurityModule);
autoInject($role, SecurityModule);
autoInject($permission, SecurityModule);
