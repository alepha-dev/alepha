import { type Infer, z } from "alepha";

import { folioColumnOptionsSchema } from "./folioColumnOptionsSchema.ts";
import { folioColumnTypeSchema } from "./folioColumnTypeSchema.ts";

/**
 * One column of a table folio, as the API answers it.
 */
export const folioColumnResourceSchema = z.object({
  id: z.uuid(),
  position: z.integer(),
  name: z.string(),
  type: folioColumnTypeSchema,
  options: folioColumnOptionsSchema,
});

export type FolioColumnResource = Infer<typeof folioColumnResourceSchema>;
