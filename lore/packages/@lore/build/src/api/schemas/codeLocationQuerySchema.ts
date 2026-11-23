import { z } from "alepha";

/**
 * Where in a repository a read looks (#Q4134), two ways:
 *
 * - `at`: a code URL's tail, `<revision>/<path>`, the revision found as the
 *   LONGEST branch or tag that prefixes it, then a commit sha, so a branch
 *   named `feat/foo` and a path under it never read ambiguously. What the
 *   pages send.
 * - `ref` and `path`, apart: what the CLI and the tools send. `ref` defaults
 *   to the default branch.
 */
export const codeLocationQuerySchema = z.object({
  at: z.text({ maxLength: 4096 }).optional(),
  ref: z.text({ maxLength: 255 }).optional(),
  path: z.text({ maxLength: 4096 }).optional(),
});
