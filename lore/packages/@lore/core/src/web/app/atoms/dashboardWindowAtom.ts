import { $atom, z } from "alepha";

/**
 * The project board's time window, per viewer (#Q2661): 7, 14 or 30 days,
 * passed to every tile in the board's one resolve, so deltas and sparklines
 * agree with each other.
 *
 * Per viewer, not on the board: two members reading the same board may want
 * different windows, and a window is how somebody reads, not what the
 * project is.
 *
 * `persist: "cookie"`, for the reason `questLogCollapsedAtom` gives: the
 * route loader reads it during SSR, where web storage does not exist.
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const dashboardWindowAtom = $atom({
  name: "lor.dashboard.window",
  schema: z.object({
    days: z.enum(["7", "14", "30"]),
  }),
  default: { days: "14" },
  persist: "cookie",
});
