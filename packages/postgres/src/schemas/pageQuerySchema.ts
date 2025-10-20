import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const pageQuerySchema = t.object({
  page: t.optional(
    t.int({
      description: "The page number to retrieve.",
      minimum: 0,
      default: 0,
    }),
  ),
  size: t.optional(
    t.int({
      description: "The number of items per page.",
      minimum: 1,
      maximum: 100,
      default: 10,
    }),
  ),
  sort: t.optional(
    t.text({
      description:
        "Sort by field(s). Multiple columns separated by comma. Prefix with '-' for DESC. Examples: 'name' (ASC), '-createdAt' (DESC), 'role,-name' (role ASC, name DESC)",
    }),
  ),
});

export type PageQuery = Static<typeof pageQuerySchema>;
