import { $atom, type Infer, z } from "alepha";

import { SIGIL_TRACKERS } from "./sigilFeatures.ts";

/**
 * How long a stamped config is taken at face value by the browser.
 *
 * Generous, because the only cost of being wrong in this direction is one
 * request. A page rendered for this visitor is stamped within milliseconds, so
 * anything approaching a minute old was served from something that kept it —
 * a prerendered file, an edge cache, the back/forward cache.
 */
export const SIGIL_CONFIG_FRESH_MS = 60_000;

/**
 * How long the browser waits before its first ingest call when the page it was
 * served carries a stale config.
 *
 * The call used to go out the moment the render hook fired. That put a request
 * on the wire while the main thread was still hydrating, and spent a whole
 * round trip to carry a single pageview — everything else the page produces
 * (TTFB, FCP) lands a beat later and went out in a second request.
 *
 * Waiting for LCP is what makes it one request instead of two, and this is the
 * ceiling on that wait. It is a ceiling rather than a fixed delay because LCP
 * is not guaranteed to arrive: the entry type is unsupported in some browsers,
 * and a page whose largest element is painted at first paint may never dispatch
 * a later one. Without the ceiling such a page would never hear its config
 * again, which is the one state a page must always be able to leave.
 */
export const SIGIL_FIRST_INGEST_MAX_MS = 2_000;

/**
 * The public sigil config handed to the browser: which trackers are on, which
 * paths to skip, and where feedback goes.
 *
 * **It never contains the key.** The browser talks only to its own origin; the
 * credential stays on the app's server, where the sink is called from.
 *
 * ## Why it carries a timestamp
 *
 * HTML outlives the config inside it. A prerendered page was rendered in CI and
 * may be served for weeks; a cached SSR response is served for its TTL; a
 * back/forward restore replays a document from an earlier session. In every one
 * of those the embedded config describes a moment that has passed, and the
 * browser has no way to tell that from a page rendered for it just now.
 *
 * {@link configAt} is what tells it apart, and it is deliberately a stamp
 * rather than a `fresh: boolean`. A boolean can only record "a server rendered
 * this", which was true an hour ago and answers the wrong question. The
 * question is whether *this HTML* has outlived its config, and only the age
 * answers it — the same test, correctly, for a file built in CI and for a
 * response cached at an edge for an hour.
 *
 * It also needs nothing from the framework. Deciding server-side would mean
 * distinguishing a prerender from a request, and nothing in Alepha does: the
 * build calls the same render path and fires the same hooks, so a module has no
 * way to know which one it is in.
 *
 * A stale stamp is not an error and not a reason to stop collecting — it means
 * "ask, then act", which is what `SigilBrowserProvider` does with it.
 */
export const sigilClientAtom = $atom({
  name: "alepha.sigil.client",
  description:
    "Public sigil config sent to the browser: enabled trackers, feedback URL and where it is hidden, and when it was stamped. Never contains the key.",
  schema: z.object({
    enabled: z.record(z.string(), z.boolean()),
    feedbackButtonExcludedPaths: z.array(z.string()),
    feedbackUrl: z.string().optional(),
    feedbackButton: z.string().optional(),
    /**
     * When the server last resolved this, in epoch millis.
     *
     * `0` means "never" — the value below is the module's own default, not an
     * answer from a server, so it is stale by construction and the browser
     * asks before acting on it.
     */
    configAt: z.number(),
  }),
  default: {
    enabled: Object.fromEntries(SIGIL_TRACKERS.map((t) => [t, true])),
    feedbackButtonExcludedPaths: [],
    configAt: 0,
  },
});

export type SigilClientConfig = Infer<typeof sigilClientAtom.schema>;

/**
 * Whether a stamped config still describes the present.
 *
 * Compares against the visitor's clock, which is the only one available here.
 * A badly skewed clock costs at most one extra request, or one page acting on a
 * config a little older than it should — neither is worth a handshake to avoid.
 */
export const sigilConfigIsFresh = (config: SigilClientConfig, now: number) =>
  config.configAt > 0 && now - config.configAt < SIGIL_CONFIG_FRESH_MS;
