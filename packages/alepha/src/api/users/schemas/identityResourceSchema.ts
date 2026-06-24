import type { Static } from "alepha";
import { identities } from "../entities/identities.ts";

export const identityResourceSchema = identities.schema.omit({
  password: true,
});

export type IdentityResource = Static<typeof identityResourceSchema>;
