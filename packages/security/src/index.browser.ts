import { $module } from "@alepha/core";

export * from "./errors/InvalidPermissionError.ts";
export * from "./errors/SecurityError.ts";
export * from "./interfaces/UserAccountInfo.ts";
export * from "./interfaces/UserAccountToken.ts";
export * from "./schemas/permissionSchema.ts";
export * from "./schemas/roleSchema.ts";

export const AlephaSecurity = $module({
	name: "alepha.security",
});
