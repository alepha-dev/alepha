import { type Static, z } from "alepha";

/**
 * The metrics an app reports about itself, on the sink's interval.
 *
 * A closed set on purpose: these five answer "is it healthy and how hard is it
 * working", every runtime can produce them, and the sink can chart them without
 * knowing anything about the app. Custom series would each need a unit, a
 * meaning and a retention policy — that is a metrics product, not a heartbeat.
 */
export const TELEMETRY_SERIES = [
  "rss",
  "heapUsed",
  "eventLoopDelayP95",
  "reqCount",
  "reqDurationP95",
] as const;

export type TelemetrySeries = (typeof TELEMETRY_SERIES)[number];

/**
 * Mutualized telemetry envelope the browser POSTs to the same-origin proxy,
 * and that the server forwards to the sink.
 *
 * The proxy stamps `country` + `visitor` server-side — the browser never sets
 * them, and the raw IP never leaves the app.
 *
 * Every array is capped. A payload over the cap is refused with 413 rather than
 * truncated: silently dropping the tail of a batch makes a sink look healthy
 * while it loses data.
 */
export const pulseEnvelope = z.object({
  views: z
    .array(z.object({ path: z.string().max(1024) }))
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
      }),
    )
    .max(50)
    .optional(),
  metrics: z
    .array(
      z.object({
        series: z.enum(TELEMETRY_SERIES).meta({ mode: "text" }),
        value: z.number(),
        /** Epoch millis the sample was taken, not when it was received. */
        at: z.integer(),
      }),
    )
    .max(60)
    .optional(),
  /**
   * Proof of life, sent alongside the metrics.
   *
   * The app never claims to be healthy — it says what it is running and for how
   * long, and the sink decides. Up/down is derived from the silence, so an app
   * that dies cannot lie about it.
   */
  heartbeat: z
    .object({
      release: z.string().max(200).optional(),
      uptimeSec: z.number(),
      /**
       * True when nothing is in flight: no request, no job, no socket. Only
       * meaningful as a hint for scale-to-zero, never as a health signal.
       */
      idle: z.boolean().optional(),
    })
    .optional(),
});

export type PulseEnvelope = Static<typeof pulseEnvelope>;

/**
 * What the sink receives: the envelope plus the fields only the app's own
 * server can honestly fill in.
 */
export const telemetryForwarded = pulseEnvelope.extend({
  country: z.string().max(8).optional(),
  visitor: z.string().max(128).optional(),
});
