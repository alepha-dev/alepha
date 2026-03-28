import type { Static } from "alepha";
import { t } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const organizationQuerySchema = t.extend(pageQuerySchema, {
  name: t.optional(t.text({ description: "Filter by name (partial match)" })),
  enabled: t.optional(t.boolean({ description: "Filter by enabled status" })),
});

export type OrganizationQuery = Static<typeof organizationQuerySchema>;
