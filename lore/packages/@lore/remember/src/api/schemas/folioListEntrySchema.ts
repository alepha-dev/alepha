import { type Infer, z } from "alepha";

import { folioRowSchema } from "./folioRowSchema.ts";

/**
 * One folio of a searched list: the folio, and for a table found by one of
 * its rows, that row (#E144, #Q3514). A folio appears once however many of
 * its rows match; `rowMatch` is the first in position order.
 *
 * `content` is present only when the call asked for it (#Q3712): the body was
 * 47% of a page of 50 on a large project, and only the callers that cut a
 * snippet out of it read it.
 */
export const folioListEntrySchema = folioRowSchema.extend({
  content: z.string().optional(),
  rowMatch: z
    .object({
      number: z.integer(),
      text: z.string(),
    })
    .optional(),
});

export type FolioListEntry = Infer<typeof folioListEntrySchema>;
