import { type Infer, z } from "alepha";

/**
 * A local repository Loom watches.
 *
 * Response fields are `z.string()`, never `z.text()`: `z.text()` caps at 255
 * characters, and a path or a title past that would fail the response and
 * blank the screen.
 */
export const projectSchema = z.object({
  /**
   * Stable handle, derived from the name when the project is added. It is
   * what the URL carries: `/projects/alepha`.
   */
  id: z.string(),
  name: z.string(),
  /**
   * The repository's top level, absolute.
   */
  path: z.string(),
  /**
   * The Lore project the `#Q` numbers in this repository's commits belong to.
   */
  loreProjectId: z.integer().optional(),
  /**
   * That Lore project's slug, which quest links are built from.
   */
  loreProjectSlug: z.string().optional(),
});

export type Project = Infer<typeof projectSchema>;
