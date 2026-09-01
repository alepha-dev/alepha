import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./entities/invitations.ts";
export * from "./schemas/createInvitationSchema.ts";
export * from "./schemas/invitationQuerySchema.ts";
export * from "./schemas/invitationResourceSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Browser half of `alepha/api/invitations`: the entity and the schemas a
 * client needs to validate a response, and none of the services.
 *
 * ⚠️ A new schema export must be added HERE as well as in `index.ts`. The two
 * barrels are not derived from each other, and a client importing a name this
 * one omits fails only in a browser build.
 *
 * @module alepha.api.invitations
 */
export const AlephaApiInvitations = $module({
  name: "alepha.api.invitations",
  services: [],
});
