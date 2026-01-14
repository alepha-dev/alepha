import { $module } from "alepha";

export * from "./errors/InvalidCredentialsError.ts";
export * from "./errors/InvalidPermissionError.ts";
export * from "./errors/SecurityError.ts";
export * from "./interfaces/UserAccountToken.ts";
export * from "./schemas/permissionSchema.ts";
export * from "./schemas/roleSchema.ts";
export * from "./schemas/userAccountInfoSchema.ts";

export const AlephaSecurity = $module({
  name: "alepha.security",
});

/**
 * @deprecated Use `AlephaSecurity` instead. Server security providers are automatically registered when `AlephaServer` is available.
 */
export const AlephaServerSecurity = AlephaSecurity;
