import { type Infer, z } from "alepha";

/**
 * The closed set of states a row, a segment or a status pill can carry.
 *
 * A tone, not a word: the renderer maps each to a colour token and the locale
 * names whatever the row is about. `accent` is the one that says "this is the
 * thing to look at" without saying it is good or bad (an epic in progress).
 */
export const dashboardTileStateSchema = z.enum([
  "ok",
  "warn",
  "bad",
  "neutral",
  "accent",
]);

export type DashboardTileState = Infer<typeof dashboardTileStateSchema>;
