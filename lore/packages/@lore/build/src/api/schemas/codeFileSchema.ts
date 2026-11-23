import { z } from "alepha";

import { codeRevisionSchema } from "./codeRevisionSchema.ts";

/**
 * One file at a revision (#Q4134). `text` is there when `status` is `ok`:
 * a binary file or one over the page's cap is named, and downloaded raw.
 */
export const codeFileSchema = z.object({
  revision: codeRevisionSchema,
  path: z.text({ maxLength: 4096 }),
  sha: z.text({ minLength: 40, maxLength: 40 }),
  size: z.integer(),
  status: z.enum(["ok", "binary", "too_large"]),
  text: z.string().optional(),
});
