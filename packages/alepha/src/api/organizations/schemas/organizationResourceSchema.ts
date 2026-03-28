import type { Static } from "alepha";
import { organizations } from "../entities/organizations.ts";

export const organizationResourceSchema = organizations.schema;

export type OrganizationResource = Static<typeof organizationResourceSchema>;
