import type { Static } from "alepha";
import { t } from "alepha";

export const createOrganizationSchema = t.object({
  name: t.text(),
  slug: t.text({ minLength: 2, maxLength: 100 }),
  enabled: t.optional(t.boolean()),
});

export type CreateOrganization = Static<typeof createOrganizationSchema>;
