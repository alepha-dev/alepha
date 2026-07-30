import { type Static, z } from "alepha";

/**
 * Body schema for the sigil telemetry ingest batch.
 *
 * Used by both the trusted server-to-server `$route` (`POST /sigils/:id/ingest`
 * in `SigilIngestController`) and the in-process path (`SigilIngestRunner`,
 * invoked by `LoreTelemetrySinkProvider` when Lore dogfoods its own sigil).
 *
 * All three capability buckets are optional: a caller sends only what it has.
 * `country` and `visitor` are stamped by the caller and apply to the whole
 * batch (the daily visitor hash is derived server-side, never the raw IP).
 *
 * Length constraints mirror the `@alepha/telemetry` schemas but are declared
 * locally to avoid importing from `@alepha/telemetry` (that barrel pulls React).
 */
export const sigilIngestBodySchema = z.object({
  /**
   * Pageview hits. Each item carries the path the user visited.
   * The `beacon` capability gate must pass for these to be recorded.
   */
  views: z
    .array(
      z.object({
        path: z.string().max(5_000),
      }),
    )
    .max(50)
    .optional(),
  /**
   * Crash / error events. Each item carries name, message, stack, and
   * optional sourceUrl. The `blights` capability gate must pass.
   */
  errors: z
    .array(
      z.object({
        name: z.string().max(500).optional(),
        message: z.string().max(5_000).optional(),
        stack: z.string().max(20_000).optional(),
        sourceUrl: z.string().max(5_000).optional(),
        origin: z.enum(["client", "server"]).meta({ mode: "text" }).optional(),
      }),
    )
    .max(20)
    .optional(),
  /**
   * Web-Vitals samples. Each item carries path, metric name, and raw value.
   * The `vitals` capability gate must pass.
   */
  vitals: z
    .array(
      z.object({
        path: z.string().max(5_000),
        metric: z.string().max(50),
        value: z.number(),
      }),
    )
    .max(100)
    .optional(),
  /**
   * ISO 3166-1 alpha-2 country code stamped by the caller (e.g. from
   * `cf-ipcountry`, GeoIP, or a CDN header). Defaults to `"ZZ"` when absent.
   * Applied to all views in the batch.
   */
  country: z.string().max(8).optional(),
  /**
   * Caller-computed daily visitor hash. When present it is stored as-is as
   * `sessionHash` in `sigil_unique_visitors` (the caller already derived the
   * day-scoped hash from the visitor's IP + UA). When absent, the
   * unique-visitor insert is skipped.
   */
  visitor: z.string().max(256).optional(),
});

export type SigilIngestBody = Static<typeof sigilIngestBodySchema>;
