import { type Infer, z } from "alepha";

import { folioCellValueSchema } from "./folioCellValueSchema.ts";

/**
 * One row of a table folio, as the API answers it: its cells keyed by
 * column id, each read leniently (a value that no longer fits its column is
 * `null`). Every column of the table has a key.
 */
export const folioRowResourceSchema = z.object({
  id: z.uuid(),
  number: z.integer(),
  position: z.number(),
  version: z.integer(),
  cells: z.record(z.text(), folioCellValueSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  updatedByUserId: z.uuid().optional(),
});

export type FolioRowResource = Infer<typeof folioRowResourceSchema>;
