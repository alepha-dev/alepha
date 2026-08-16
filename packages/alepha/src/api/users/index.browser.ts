import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./entities/identities.ts";
export * from "./entities/sessions.ts";
export * from "./entities/users.ts";
export * from "./schemas/registerSchema.ts";
export * from "./schemas/resetPasswordSchema.ts";
// The account page validates against the server's own contract rather than
// restating "3 to 30 characters" client-side — the same reasoning the schema
// itself gives for reusing the entity's column. It pulls in nothing but the
// `users` entity and zod, both already here.
export * from "./schemas/updateMyProfileBodySchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaApiUsers = $module({
  name: "alepha.api.users",
  services: [],
});
