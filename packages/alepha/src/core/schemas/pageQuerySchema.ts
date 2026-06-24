import { type Static, z } from "../providers/TypeProvider.ts";

export const pageQuerySchema = z.object({
  page: z
    .integer()
    .min(0)
    .describe("The page number to retrieve.")
    .default(0)
    .optional(),
  size: z
    .integer()
    .min(1)
    .max(100)
    .describe("The number of items per page.")
    .default(10)
    .optional(),
  sort: z
    .text({
      description:
        "Sort by field(s). Multiple columns separated by comma. Prefix with '-' for DESC. Examples: 'name' (ASC), '-createdAt' (DESC), 'role,-name' (role ASC, name DESC)",
    })
    .optional(),
});

export type PageQuery = Static<typeof pageQuerySchema>;
