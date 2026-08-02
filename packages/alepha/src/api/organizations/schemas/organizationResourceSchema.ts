import type { Infer } from "alepha";
import { organizations } from "../entities/organizations.ts";

export const organizationResourceSchema = organizations.schema;

export type OrganizationResource = Infer<typeof organizationResourceSchema>;
