import { z } from "alepha";

import { codeRepositorySlugSchema } from "./codeRepositorySlugSchema.ts";

/**
 * A repository as the API answers it: what a CLI needs to clone it.
 */
export const codeRepositorySchema = z.object({
  id: z.uuid(),
  projectId: z.integer(),
  slug: codeRepositorySlugSchema,
  defaultBranch: z.text(),
  /**
   * The HTTPS clone URL on this Lore: `/<project>/<slug>.git`, or
   * `/<project>.git` for the repository named like its project.
   */
  cloneUrl: z.text({ maxLength: 2048 }),
  createdAt: z.datetime(),
});
