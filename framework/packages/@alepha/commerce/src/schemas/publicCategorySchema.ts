import { type Infer, z } from "alepha";

/**
 * A category as a storefront reads it, flat: `parentId` is enough to draw the
 * tree.
 */
export const publicCategorySchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().optional(),
  slug: z.text(),
  name: z.text(),
  description: z.text({ maxLength: 4000 }).optional(),
});

export type PublicCategory = Infer<typeof publicCategorySchema>;
