import { t } from "alepha";

/**
 * Mutualized telemetry envelope the browser POSTs to the same-origin proxy.
 * The proxy stamps `country` + `visitor` server-side before forwarding to
 * Lore — the browser never sets them.
 */
export const sigilIngestEnvelope = t.object({
  views: t.optional(
    t.array(t.object({ path: t.string({ maxLength: 1024 }) }), { maxItems: 50 }),
  ),
  errors: t.optional(
    t.array(
      t.object({
        name: t.string({ maxLength: 200 }),
        message: t.string({ maxLength: 2000 }),
        stack: t.string({ maxLength: 4096 }),
        sourceUrl: t.string({ maxLength: 2000 }),
        origin: t.optional(t.enum(["client", "server"], { mode: "text" })),
      }),
      { maxItems: 20 },
    ),
  ),
  vitals: t.optional(
    t.array(
      t.object({
        path: t.string({ maxLength: 1024 }),
        metric: t.enum(["lcp", "cls", "inp", "fcp", "ttfb"], { mode: "text" }),
        value: t.number(),
      }),
      { maxItems: 50 },
    ),
  ),
});

/**
 * What Lore receives: the envelope plus server-stamped country + visitor.
 */
export const sigilIngestForwarded = t.extend(sigilIngestEnvelope, {
  country: t.optional(t.string({ maxLength: 8 })),
  visitor: t.optional(t.string({ maxLength: 128 })),
});
