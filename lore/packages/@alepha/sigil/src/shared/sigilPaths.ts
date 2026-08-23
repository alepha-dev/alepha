/**
 * The one path a sink must serve, and the only one this package calls.
 *
 * Exported rather than written out at each end, because the failure mode of a
 * disagreement is silent: the client fails open on purpose (a sink that is
 * down must not silence an app's reporting), so a flush to a path nothing
 * serves is a 404 swallowed by a `log.warn`. Nothing turns red; the sink just
 * stays empty. That is exactly how the two ends drifted apart once already,
 * when the sink's routes moved and the cable's literals did not.
 *
 * A root path, not `/api/*`: it is served with `$route`, because `$action`
 * imposes an `/api` prefix and its dispatcher shadows anything else underneath
 * it, so an ingest endpoint declared there answers 404 to the client it exists
 * for.
 *
 * Part of the wire contract alongside `sigilEnvelope`, what is sent to it.
 * Changing either is changing the protocol, and both ends have to move
 * together.
 */
export const SIGIL_INGEST_PATH = "/sigils/ingest";
