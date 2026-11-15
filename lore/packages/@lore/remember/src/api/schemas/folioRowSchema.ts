import { type Infer, z } from "alepha";

import { folios } from "../entities/folios.ts";

/**
 * A folio as the API answers it: the row, plus the epic that files it.
 *
 * `epicId` is not a column any more (#Q2627). An epic files a folio through a
 * `filed` link in core's graph (#Q2626), and the folio itself does not know
 * it; the controller stamps the field from that graph so the HTTP and MCP
 * contracts keep it.
 *
 * `searchText` is left out (#Q3712). It is the lowercased copy of title,
 * summary and body that `LIKE` runs over, so it doubled every response that
 * carried a body, and no client reads it. The codec strips an undeclared key,
 * so a handler may still return the whole row.
 */
export const folioRowSchema = folios.schema.omit({ searchText: true }).extend({
  epicId: z.integer().optional(),
});

export type FolioRow = Infer<typeof folioRowSchema>;
