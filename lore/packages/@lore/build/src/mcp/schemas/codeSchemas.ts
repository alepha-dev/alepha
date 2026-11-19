import { projectParamsSchema } from "@lore/core/schemas";
import { z } from "alepha";

import { codeRepositorySchema } from "../../api/schemas/codeRepositorySchema.ts";
import { codeRepositorySlugSchema } from "../../api/schemas/codeRepositorySlugSchema.ts";

/**
 * The params and results of the `code_repo_*` tools (#Q3934), one for one
 * with `lore code repo list|create|delete`.
 */
export const codeRepoListParamsSchema = projectParamsSchema.strict();

export const codeRepoListResultSchema = z.object({
  repositories: z.array(codeRepositorySchema),
});

export const codeRepoCreateParamsSchema = projectParamsSchema
  .extend({
    slug: codeRepositorySlugSchema.describe(
      "The repository's name in its clone URL, [a-z0-9-]. Named like the project, it is cloned from /<project>.git.",
    ),
    default_branch: z
      .string()
      .min(1)
      .max(255)
      .describe("The branch HEAD names. Defaults to main.")
      .optional(),
  })
  .strict();

export const codeRepoDeleteParamsSchema = projectParamsSchema
  .extend({
    slug: codeRepositorySlugSchema.describe("The repository to delete."),
  })
  .strict();

export const codeRepoDeleteResultSchema = z.object({ ok: z.boolean() });
