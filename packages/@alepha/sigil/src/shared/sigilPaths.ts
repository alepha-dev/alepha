/**
 * The two paths a sink must serve, and the only two this package calls.
 *
 * Exported rather than written out at each end, because the failure mode of a
 * disagreement is silent in both directions. The client fails open on purpose —
 * a sink that is down must not silence an app's reporting — so a flush to a
 * path nothing serves is a 404 swallowed by a `log.warn`, and a config fetch to
 * one falls back to "collect everything" without ever saying why. Nothing turns
 * red; the sink just stays empty. That is exactly how these two drifted apart
 * once already, when the sink's routes moved and the cable's literals did not.
 *
 * Root paths, not `/api/*`: they are served with `$route`, because `$action`
 * imposes an `/api` prefix and its dispatcher shadows anything else underneath
 * it — an ingest endpoint declared there answers 404 to the client it exists
 * for.
 *
 * They are part of the wire contract, alongside `sigilEnvelope` (what is sent
 * to the first) and `sigilConfig` (what comes back from the second). Changing
 * one is changing the protocol, and both ends have to move together.
 */
export const SIGIL_INGEST_PATH = "/sigils/ingest";

/**
 * @see {@link SIGIL_INGEST_PATH}
 */
export const SIGIL_CONFIG_PATH = "/sigils/config";
