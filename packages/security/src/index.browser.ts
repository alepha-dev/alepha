import { $module } from "@alepha/core";

export * from "./errors/InvalidPermissionError.ts";
export * from "./errors/SecurityError.ts";
export * from "./interfaces/UserAccountToken.ts";
export * from "./schemas/permissionSchema.ts";
export * from "./schemas/roleSchema.ts";
export * from "./schemas/userAccountInfoSchema.ts";

export const AlephaSecurity = $module({
  name: "alepha.security",
});
