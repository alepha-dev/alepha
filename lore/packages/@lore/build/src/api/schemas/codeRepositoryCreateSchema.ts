import { z } from "alepha";

import { codeRepositorySlugSchema } from "./codeRepositorySlugSchema.ts";

/**
 * What creating a repository takes: its slug and, optionally, the branch its
 * HEAD names (`main` when omitted).
 */
export const codeRepositoryCreateSchema = z.object({
  slug: codeRepositorySlugSchema,
  defaultBranch: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
    .optional(),
});
