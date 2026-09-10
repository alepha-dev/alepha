import { type Infer, z } from "alepha";

/**
 * What adding a project takes: a path, and optionally how it is named and
 * which Lore project its quests live in.
 */
export const projectCreateSchema = z.object({
  /**
   * Any directory inside the repository; `~` is expanded. The project is
   * stored at the repository's top level.
   */
  path: z.string().min(1).max(1024),
  /**
   * Defaults to the top level's directory name.
   */
  name: z.string().max(80).optional(),
  loreProjectId: z.integer().min(1).optional(),
  loreProjectSlug: z.string().max(80).optional(),
});

export type ProjectCreate = Infer<typeof projectCreateSchema>;
