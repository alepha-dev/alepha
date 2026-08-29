import { z } from "alepha";

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
  range: z.enum(["1d", "7d", "30d"]).optional(),
  traffic: z.enum(["all", "humans", "bots"]).optional(),
});
