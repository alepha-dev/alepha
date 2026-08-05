/**
 * What this package can collect. One name per tracker, used identically by the
 * envelope, by the sink's `enabled` kill-switches and by the browser gate — so
 * a tracker switched off in one place is off everywhere.
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

/**
 * Every tracker on.
 *
 * The state to start from before the sink has answered, and the one to fall
 * back to when it never does: this module's job is to keep collecting, and it
 * is the sink that decides to want less.
 */
export const allTrackersEnabled = (): Record<SigilTracker, boolean> =>
  Object.fromEntries(SIGIL_TRACKERS.map((t) => [t, true])) as Record<
    SigilTracker,
    boolean
  >;
