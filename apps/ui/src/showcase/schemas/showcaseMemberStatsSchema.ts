import { z } from "alepha";

/**
 * Counts over the members a query matches: the figures of the DataTable
 * Addons page's summary panel.
 */
export const showcaseMemberStatsSchema = z.object({
  total: z.integer(),
  active: z.integer(),
  invited: z.integer(),
  teams: z.integer(),
});
