import { type Infer, z } from "alepha";

/**
 * Mutualized sigil envelope the browser POSTs to the same-origin proxy,
 * and that the server forwards to the sink.
 *
 * The proxy stamps `country` + `visitor` server-side — the browser never sets
 * them, and the raw IP never leaves the app.
 *
 * Every array is capped. A payload over the cap is refused with 413 rather than
 * truncated: silently dropping the tail of a batch makes a sink look healthy
 * while it loses data.
 */
/**
 * When the event happened, epoch milliseconds, as claimed by the client.
 *
 * The sink used to bucket everything at absorb time, which is when the batch
 * arrived rather than when the page was viewed. The browser holds a batch for
 * five seconds, the app's own sink provider holds it for up to ten more, and a
 * retry adds however long the sink was unreachable — so an event near an hour
 * boundary routinely landed in the wrong bucket, and a deploy at 14:00 could
 * not be read against 13:00, which is the entire reason these buckets are
 * hourly.
 *
 * Optional, and it stays optional: a browser bundle and the sink it reports to
 * deploy independently, so a client that predates this field must keep working.
 * Absent means "use absorb time", the old behaviour.
 *
 * **Client-supplied and therefore hostile.** Nothing stops whoever holds the
 * sigil token from claiming any time at all, so the sink clamps it to a window
 * around its own clock before it reaches a bucket. Trusting it outright would
 * let a token-holder rewrite history rather than merely inflate the present,
 * which is the weaker property the count already has.
 */
export const sigilEventTime = z.integer().min(0).optional();

export const sigilEnvelope = z.object({
  views: z
    .array(
      z.object({
        path: z.string().max(1024),
        ts: sigilEventTime,
        /**
         * The **host** the visit arrived from, cross-origin only.
         *
         * Set on a page load's own view and on nothing else: `document.referrer`
         * does not change across a client-side navigation, so attaching it to
         * every view in a session would report one arrival as five. Absent
         * therefore means either "no external referrer" or "not the landing
         * view", and the sink cannot tell those apart — it folds both into
         * `direct`, which is the honest name for that union.
         *
         * Never a full URL. See {@link sigilReferrerHost} for why the path and
         * query of a *third-party* page are not this app's to record.
         */
        referrer: z.string().max(253).optional(),
        /**
         * `true` on the view a page load produces, absent on every view a
         * client-side navigation produces.
         *
         * Explicit rather than inferred from {@link referrer} being present:
         * a landing view with no external referrer is the common case, so
         * "has a referrer" and "is an arrival" are different questions and
         * only one of them can be answered by the same field.
         *
         * This is what makes a landing-page report and a bounce rate possible
         * at all. Without it `/` is one number mixing arrivals with everyone
         * who clicked Home.
         */
        entry: z.boolean().optional(),
        /**
         * `utm_campaign`, falling back to `utm_source`, from the landing URL.
         *
         * Only ever set alongside {@link entry}: a campaign describes how a
         * visit began, and `location.search` on a later client-side
         * navigation has nothing to do with how the visitor arrived.
         *
         * Carried separately rather than left in `path` because
         * `SigilIngestService.normalizePath` splits on `?` — which is
         * deliberate, and is why a tagged link is invisible today.
         */
        campaign: z.string().max(64).optional(),
      }),
    )
    .max(50)
    .optional(),
  /**
   * Paths the visitor actually engaged with: scrolled, clicked, or stayed on
   * past a few seconds.
   *
   * A separate array rather than a flag on the view because the two are known
   * at different times. A view is queued the moment the page renders;
   * engagement is by definition not knowable then, and holding the view back
   * until it were would mean losing views whose beacon never flushes.
   *
   * Analytics Engine is append-only, so the sink records this as a row with
   * `count: 0, engaged: 1` — measures sum independently, and the engagement
   * rate falls out as `engaged / count` without either number needing to be
   * rewritten.
   *
   * Behavioural rather than a user-agent guess, which is the point: a scraper
   * driving a real headless browser sends a perfectly ordinary Chrome UA, and
   * still never scrolls.
   */
  engagements: z
    .array(z.object({ path: z.string().max(1024), ts: sigilEventTime }))
    .max(50)
    .optional(),
  errors: z
    .array(
      z.object({
        name: z.string().max(200),
        message: z.string().max(2000),
        stack: z.string().max(4096),
        sourceUrl: z.string().max(2000),
        origin: z.enum(["client", "server"]).meta({ mode: "text" }).optional(),
        /**
         * How many times this exact error occurred in the sending window.
         *
         * The whole point of aggregating before sending: a crash loop is one
         * line with a count, not a thousand identical events. Absent means one.
         */
        count: z.integer().min(1).optional(),
      }),
    )
    .max(20)
    .optional(),
  vitals: z
    .array(
      z.object({
        path: z.string().max(1024),
        metric: z
          .enum(["lcp", "cls", "inp", "fcp", "ttfb"])
          .meta({ mode: "text" }),
        value: z.number(),
        ts: sigilEventTime,
      }),
    )
    .max(50)
    .optional(),
});

export type SigilEnvelope = Infer<typeof sigilEnvelope>;

/**
 * What the sink receives: the envelope plus the fields only the app's own
 * server can honestly fill in.
 */
export const sigilForwarded = sigilEnvelope.extend({
  country: z.string().max(8).optional(),
  visitor: z.string().max(128).optional(),
  /**
   * `mobile` | `tablet` | `desktop`, classified from the user-agent.
   *
   * Stamped by the proxy next to `country` rather than sent by the browser,
   * for the same reason: the app's own server already has the header, so
   * there is no call to spend bytes in the envelope on something it can read
   * for free. It stamps the whole batch, which is correct — a device does not
   * change between two views of one session.
   */
  device: z.string().max(16).optional(),
});

export type SigilForwarded = Infer<typeof sigilForwarded>;
