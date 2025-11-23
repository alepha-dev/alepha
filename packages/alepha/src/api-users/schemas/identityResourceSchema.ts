import type { Static } from "alepha";
import { t } from "alepha";
import { identities } from "../entities/identities.ts";

export const identityResourceSchema = t.omit(identities.schema, ["password"]);

export type IdentityResource = Static<typeof identityResourceSchema>;
