import { z } from "alepha";

import { codeDiffFileSchema } from "./codeDiffFileSchema.ts";

/**
 * A page of the diff between two commits (#Q4135).
 */
export const codeDiffSchema = z.object({
  /**
   * Undefined for a root commit: the diff is from the empty tree.
   */
  from: z.text({ minLength: 40, maxLength: 40 }).optional(),
  to: z.text({ minLength: 40, maxLength: 40 }),
  files: z.array(codeDiffFileSchema),
  /**
   * Every changed file, over every page.
   */
  total: z.integer(),
  page: z.integer(),
  pageSize: z.integer(),
  /**
   * The file list stopped at its cap.
   */
  partial: z.boolean(),
});
