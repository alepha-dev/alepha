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
export const sigilEnvelope = z.object({
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
