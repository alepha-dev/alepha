import { z } from "alepha";

/**
 * Mutualized telemetry envelope the browser POSTs to the same-origin proxy.
 * The proxy stamps `country` + `visitor` server-side before forwarding to
 * Lore — the browser never sets them.
 */
export const sigilIngestEnvelope = z.object({
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

/**
 * What Lore receives: the envelope plus server-stamped country + visitor.
 */
export const sigilIngestForwarded = sigilIngestEnvelope.extend({
  country: z.string().max(8).optional(),
  visitor: z.string().max(128).optional(),
});
