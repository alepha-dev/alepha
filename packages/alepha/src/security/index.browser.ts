import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./atoms/currentTenantAtom.ts";
export * from "./atoms/currentUserAtom.ts";
export * from "./errors/InvalidCredentialsError.ts";
export * from "./errors/InvalidPermissionError.ts";
export * from "./errors/SecurityError.ts";
export * from "./interfaces/UserAccountToken.ts";
export * from "./primitives/$owns.browser.ts";
export * from "./primitives/$secure.browser.ts";
export * from "./providers/PermissionRegistryProvider.ts";
// The grants seam is types plus a default that allows: no ORM, no server, and
// the browser needs the type to typecheck an isomorphic `$owns({ requires })`.
export * from "./providers/ResourceGrantsProvider.ts";
export * from "./schemas/permissionSchema.ts";
export * from "./schemas/roleSchema.ts";
export * from "./schemas/userAccountInfoSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaSecurity = $module({
  name: "alepha.security",
});
