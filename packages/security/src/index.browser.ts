import { $module } from "@alepha/core";

export * from "./errors/InvalidPermissionError.ts";
export * from "./errors/SecurityError.ts";
export * from "./interfaces/UserAccountToken.ts";
export type * from "./schemas/permissionSchema.ts";
export type * from "./schemas/roleSchema.ts";
export type * from "./schemas/userAccountInfoSchema.ts";

export const AlephaSecurity = $module({
	name: "alepha.security",
});
