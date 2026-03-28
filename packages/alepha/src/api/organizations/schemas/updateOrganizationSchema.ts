import type { Static } from "alepha";
import { t } from "alepha";
import { createOrganizationSchema } from "./createOrganizationSchema.ts";

export const updateOrganizationSchema = t.partial(createOrganizationSchema);

export type UpdateOrganization = Static<typeof updateOrganizationSchema>;
