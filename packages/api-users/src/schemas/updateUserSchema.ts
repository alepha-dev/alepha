import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const updateUserSchema = t.object({
  name: t.optional(t.string()),
  firstName: t.optional(t.string()),
  lastName: t.optional(t.string()),
  picture: t.optional(t.string()),
  roles: t.optional(t.array(t.string())),
  enabled: t.optional(t.boolean()),
});

export type UpdateUser = Static<typeof updateUserSchema>;
