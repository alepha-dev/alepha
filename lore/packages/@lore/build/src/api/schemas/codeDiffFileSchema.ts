import { z } from "alepha";

import { codeDiffHunkSchema } from "./codeDiffHunkSchema.ts";

/**
 * One changed file of a diff (#Q4135). `status` says whether its hunks are
 * here: `loaded`, `pending` (asked for on demand), `collapsed` (a
 * generated file, loaded when opened), `too_large`, `binary`, `submodule`.
 */
export const codeDiffFileSchema = z.object({
  path: z.text({ maxLength: 4096 }),
  /**
   * Where a renamed file came from.
   */
  oldPath: z.text({ maxLength: 4096 }).optional(),
  kind: z.enum(["added", "modified", "deleted", "renamed"]),
  oldMode: z.text({ maxLength: 10 }).optional(),
  newMode: z.text({ maxLength: 10 }).optional(),
  oldSha: z.text({ minLength: 40, maxLength: 40 }).optional(),
  newSha: z.text({ minLength: 40, maxLength: 40 }).optional(),
  generated: z.boolean(),
  submodule: z.boolean(),
  status: z.enum([
    "loaded",
    "pending",
    "collapsed",
    "too_large",
    "binary",
    "submodule",
  ]),
  additions: z.integer().optional(),
  deletions: z.integer().optional(),
  hunks: z.array(codeDiffHunkSchema).optional(),
  /**
   * Each side's length, for the context a reader expands past the last hunk.
   */
  oldLineCount: z.integer().optional(),
  newLineCount: z.integer().optional(),
});
