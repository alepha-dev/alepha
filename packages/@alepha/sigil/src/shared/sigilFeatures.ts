/**
 * What this package can collect. One name per tracker, used identically by the
 * envelope, by the `SIGIL_CONFIG` switches and by the browser gate, so a
 * tracker switched off in one place is off everywhere.
 *
 * - `views`   — page views.
 * - `errors`  — client and server errors.
 * - `vitals`  — web-vitals samples.
 *
 * `feedback` is deliberately absent from this list: it is a link the sink hands
 * out, not something collected. It had no business among trackers.
 */
export const SIGIL_TRACKERS = ["views", "errors", "vitals"] as const;

export type SigilTracker = (typeof SIGIL_TRACKERS)[number];
