import { z } from "alepha";

import { codeDiffLineSchema } from "./codeDiffLineSchema.ts";

/**
 * A run of changes with its context, `@@ -oldStart,oldLines
 * +newStart,newLines @@` as git writes it (#Q4135).
 */
export const codeDiffHunkSchema = z.object({
  oldStart: z.integer(),
  oldLines: z.integer(),
  newStart: z.integer(),
  newLines: z.integer(),
  lines: z.array(codeDiffLineSchema),
});
