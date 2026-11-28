/**
 * The leaderboards that can be listed in full, which is exactly the set
 * `InsightsController.getInsightsDimension` accepts.
 *
 * Duplicated deliberately rather than imported from the controller: this file
 * ships to the browser, and importing a controller module would pull the
 * repositories and the database provider into the client bundle. `entryPath`
 * is in the list and is not a dataset dimension - it groups by `path` and
 * differs only in the measure, which is the distinction that makes a landing
 * page report possible at all.
 */
export const ANALYTICS_DIMENSIONS = new Set([
  "country",
  "path",
  "entry",
  "exit",
  "network",
  "campaign",
  "device",
  "referrer",
  "browser",
  "os",
  "auth",
]);
