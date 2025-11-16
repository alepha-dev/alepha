import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./entities/identities.ts";
export * from "./entities/sessions.ts";
export * from "./entities/users.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaApiUsers = $module({
  name: "alepha.api.users",
  services: [],
});
