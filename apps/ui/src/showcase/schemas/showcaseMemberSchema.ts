import { z } from "alepha";

/**
 * One row of the showcase dataset.
 *
 * Declared as a schema rather than only as a TypeScript interface because
 * `schema.response` is what actually serializes: a field present on the type
 * and absent here never reaches the browser, and it fails silently.
 */
export const showcaseMemberSchema = z.object({
  id: z.text(),
  name: z.text(),
  email: z.text(),
  team: z.text(),
  role: z.text(),
  status: z.text(),
  createdAt: z.text(),
});
