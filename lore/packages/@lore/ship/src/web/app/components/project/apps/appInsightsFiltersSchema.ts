import { z } from "alepha";

import { insightsRangeSchema } from "../../../../../api/schemas/insightsRangeSchema.ts";

/**
 * The two questions the analytics tabs ask of one app, as URL params.
 *
 * They live in the URL rather than in a component or on the layout so that a
 * reload keeps them, a link carries them, and crossing between Analytics and
 * Vitals does not reset them. That last property used to come from holding the
 * state on `AppLayout`, which also meant an unkeyed atom survived a move
 * between two apps and showed the previous one's selection.
 *
 * Both fields are optional and both degrade to a default rather than to an
 * error: a stale bookmark naming a range that no longer exists should render
 * the page, not an error screen. `useQueryParams` drops a value that fails to
 * decode, which is exactly that behaviour.
 */
export const appInsightsFiltersSchema = z.object({
  /**
   * A preset window. Absent means this month to date, unless `from` and `to`
   * name a custom one.
   */
  range: insightsRangeSchema.optional(),
  /**
   * A custom window, two UTC days, both included. Only read when both are
   * there; a preset clears them.
   */
  from: z.string().optional(),
  to: z.string().optional(),
  /**
   * `true` reads the window of the same length just before, for the deltas.
   * A string rather than a boolean, so the URL says `compare=true`.
   */
  compare: z.enum(["true"]).optional(),
  traffic: z.enum(["all", "humans", "bots"]).optional(),
  /**
   * The view dimensions a leaderboard row can narrow the page to.
   *
   * In the URL for the same three reasons the window is: a filtered view
   * survives a reload, travels in a link, and is reachable from the dimension
   * detail page, which navigates BACK to the overview carrying one. Free text
   * rather than an enum by nature - these are values, not modes.
   */
  path: z.string().optional(),
  country: z.string().optional(),
  referrer: z.string().optional(),
  campaign: z.string().optional(),
  device: z.string().optional(),
  browser: z.string().optional(),
  os: z.string().optional(),
  auth: z.string().optional(),
  entry: z.string().optional(),
  exit: z.string().optional(),
  network: z.string().optional(),
  /**
   * The leaderboard whose full list is open in a dialog over the tab
   * (#Q3674), by dimension. In the URL so a reload or a shared link reopens
   * it, and so the old `/analytics/:dimension` page can redirect here with it
   * open. Not a filter: nothing sends it to the API.
   */
  leaderboard: z.string().optional(),
});
