/**
 * Version of the inspector protocol: the run registry entry and the routes.
 *
 * Bumped on any breaking change to either. A client refuses to talk to a run
 * whose entry carries a different number, rather than guessing. There is no
 * stability promise before alepha 1.0.
 *
 * - 2: `/emails` and `/sms` carry each message's `id`, for `alepha mcp`.
 */
export const INSPECTOR_PROTOCOL = 2;
