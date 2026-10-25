import { $atom, z } from "alepha";

/**
 * How many rows each table holds, by entity name, for the Rows rail.
 *
 * An atom rather than the rail's own state so the counts are fetched once per
 * devtools session (#Q2351): one `size=1` request per entity is cheap once and
 * wasteful on every visit to Rows. The open table's count is rewritten from
 * the grid each time it loads, so a create or a delete shows in the rail
 * without another pass over every table.
 */
export const devRowCountsAtom = $atom({
  name: "devtools.rowCounts",
  schema: z.record(z.text(), z.number()),
  default: {},
});
