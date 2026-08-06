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
});

export type SigilForwarded = Infer<typeof sigilForwarded>;
