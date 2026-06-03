import { type Static, t } from "alepha";

/**
 * Body schema for the sigil telemetry ingest batch.
 *
 * Used by both the trusted server-to-server `$route` (`POST /sigils/:id/ingest`
 * in `SigilIngestController`) and the in-process path (`SigilIngestRunner`,
 * invoked by `LoreSigilForwardProvider` when Lore dogfoods its own sigil).
 *
 * All three capability buckets are optional: a caller sends only what it has.
 * `country` and `visitor` are stamped by the caller and apply to the whole
 * batch (the daily visitor hash is derived server-side, never the raw IP).
 *
 * Length constraints mirror the `@alepha/sigil` schemas but are declared
 * locally to avoid importing from `@alepha/sigil` (that barrel pulls React).
 */
export const sigilIngestBodySchema = t.object({
  /**
   * Pageview hits. Each item carries the path the user visited.
   * The `beacon` capability gate must pass for these to be recorded.
   */
  views: t.optional(
    t.array(
      t.object({
        path: t.string({ maxLength: 5_000 }),
      }),
      { maxItems: 50 },
    ),
  ),
  /**
   * Crash / error events. Each item carries name, message, stack, and
   * optional sourceUrl. The `blights` capability gate must pass.
   */
  errors: t.optional(
    t.array(
      t.object({
        name: t.optional(t.string({ maxLength: 500 })),
        message: t.optional(t.string({ maxLength: 5_000 })),
        stack: t.optional(t.string({ maxLength: 20_000 })),
        sourceUrl: t.optional(t.string({ maxLength: 5_000 })),
        origin: t.optional(t.enum(["client", "server"], { mode: "text" })),
      }),
      { maxItems: 20 },
    ),
  ),
  /**
   * Web-Vitals samples. Each item carries path, metric name, and raw value.
   * The `vitals` capability gate must pass.
   */
  vitals: t.optional(
    t.array(
      t.object({
        path: t.string({ maxLength: 5_000 }),
        metric: t.string({ maxLength: 50 }),
        value: t.number(),
      }),
      { maxItems: 100 },
    ),
  ),
  /**
   * ISO 3166-1 alpha-2 country code stamped by the caller (e.g. from
   * `cf-ipcountry`, GeoIP, or a CDN header). Defaults to `"ZZ"` when absent.
   * Applied to all views in the batch.
   */
  country: t.optional(t.string({ maxLength: 8 })),
  /**
   * Caller-computed daily visitor hash. When present it is stored as-is as
   * `sessionHash` in `sigil_unique_visitors` (the caller already derived the
   * day-scoped hash from the visitor's IP + UA). When absent, the
   * unique-visitor insert is skipped.
   */
  visitor: t.optional(t.string({ maxLength: 256 })),
});

export type SigilIngestBody = Static<typeof sigilIngestBodySchema>;
