import type { Static } from "alepha";
import { createOrganizationSchema } from "./createOrganizationSchema.ts";

export const updateOrganizationSchema = createOrganizationSchema.partial();

export type UpdateOrganization = Static<typeof updateOrganizationSchema>;
