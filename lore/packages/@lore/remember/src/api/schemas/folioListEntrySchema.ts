import { type Infer, z } from "alepha";

import { folioRowSchema } from "./folioRowSchema.ts";

/**
 * One folio of a searched list: the folio, and for a table found by one of
 * its rows, that row (#E144, #Q3514). A folio appears once however many of
 * its rows match; `rowMatch` is the first in position order.
 */
export const folioListEntrySchema = folioRowSchema.extend({
  rowMatch: z
    .object({
      number: z.integer(),
      text: z.string(),
    })
    .optional(),
});

export type FolioListEntry = Infer<typeof folioListEntrySchema>;
