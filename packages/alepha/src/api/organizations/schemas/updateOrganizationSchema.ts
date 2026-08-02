import type { Infer } from "alepha";
import { createOrganizationSchema } from "./createOrganizationSchema.ts";

export const updateOrganizationSchema = createOrganizationSchema.partial();

export type UpdateOrganization = Infer<typeof updateOrganizationSchema>;
