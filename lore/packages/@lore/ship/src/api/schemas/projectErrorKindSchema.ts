import { type Infer, z } from "alepha";

/**
 * What wrote an error, which decides what its page can show (#E185):
 *
 * - `sigil`: an app reported it through the sigil ingest, from its browser
 *   or its server. It has apps and a daily series, and Lore never changes
 *   its status by itself.
 * - `uptime`: a monitor's outage. Its `origin` says `server`, but it has no
 *   app and no series, and Lore resolves and reopens it with the monitor.
 * - `run`: a failing criterion of a use case run. No app and no series
 *   either, resolved by a passing run and reopened by the next failure.
 *
 * Derived from the row (`ProjectErrorKinds.of`), never stored: `origin`
 * alone cannot tell an uptime error from a server error.
 */
export const projectErrorKindSchema = z.enum(["sigil", "uptime", "run"]);

export type ProjectErrorKind = Infer<typeof projectErrorKindSchema>;
