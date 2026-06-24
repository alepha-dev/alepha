import { $inject, z } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import { sigilUniqueVisitors } from "../entities/sigilUniqueVisitors.ts";
import { sigilViews } from "../entities/sigilViews.ts";
import { SigilIngestSupport } from "./SigilIngestSupport.ts";

/** A single pageview ping as supplied by the embed bundle. `path` untrusted. */
export interface BeaconPingInput {
  path?: string;
}

/** Outcome of ingesting one pageview ping. */
export type BeaconIngestOutcome =
  | "recorded" // view aggregated (and unique-visitor row inserted if first today)
  | "path-capped"; // view aggregation dropped: the day's distinct-path cap is full

/** Max stored length of a normalized `path`. Mirrors the column `maxLength`. */
const PATH_MAX = 1_024;
/**
 * Max distinct `(date, path)` rows a single sigil may accumulate per UTC
 * day. A runaway site (one that mints unbounded URLs — uuid-in-path,
 * cache-buster query promoted to path, etc.) would otherwise let
 * `sigil_views` grow without bound. A 101st NEVER-seen-today path is
 * dropped from view aggregation; the unique-visitor insert still happens.
 */
const DISTINCT_PATH_CAP = 100;
/** Fallback country code when Cloudflare's `cf-ipcountry` header is absent. */
const COUNTRY_FALLBACK = "ZZ";
/** Max stored length of a country code. Mirrors the column `maxLength`. */
const COUNTRY_MAX = 8;

/**
 * Engine behind `POST /sigils/:id/beacon` — privacy-first, cookieless
 * pageview analytics (design north star: umami).
 *
 * Declaring `$repository(...)` here registers `sigil_views` and
 * `sigil_unique_visitors` in the ORM/migration graph (the migration
 * generator scans instantiated repositories — same pattern as
 * `BlightIngestService`).
 *
 * Responsibilities:
 * - derive the day-scoped `sessionHash` server-side (the client NEVER
 *   supplies it),
 * - `INSERT OR IGNORE` the unique-visitor row (one per visitor per day),
 * - normalize the page `path` (drop `?query` and `#fragment`),
 * - upsert (`INSERT … ON CONFLICT DO UPDATE count = count + 1`) the
 *   pageview aggregate,
 * - enforce the per-sigil / per-day distinct-path cap (DB-derived).
 *
 * ⚠️ The raw view `count` is best-effort by design — there is NO per-IP
 * throughput cap on `/beacon` (resolved decision, folio #12): the count is
 * explicitly inflatable, the trustworthy metric is unique-visitors, and
 * volume abuse is bounded by the Cloudflare WAF per-IP rule (see CLAUDE.md
 * "Sigils ingestion — Cloudflare WAF", which covers `/beacon` too).
 */
export class BeaconIngestService {
  protected crypto = $inject(CryptoProvider);
  protected support = $inject(SigilIngestSupport);
  protected database = $inject(DatabaseProvider);
  protected views = $repository(sigilViews);
  protected uniques = $repository(sigilUniqueVisitors);

  /**
   * Whether the bot-UA noise filter should be skipped entirely. Delegates
   * to {@link SigilIngestSupport.isBotCheckDisabled} (the `DISABLE_BOT_CHECK`
   * env escape hatch is shared across the whole ingestion surface).
   */
  isBotCheckDisabled(): boolean {
    return this.support.isBotCheckDisabled();
  }

  /**
   * `sha256(sigilId + ip + userAgent + daily_salt)` — server-derived,
   * day-scoped. The client NEVER supplies this. Daily-salt rotation makes a
   * visitor non-linkable across days (GDPR-friendly, cookieless). The salt
   * comes from the shared {@link SigilIngestSupport.dailySalt}; the
   * four-part tuple is Beacons-specific so the hash itself stays here.
   */
  sessionHash(
    sigilId: string,
    ip: string,
    userAgent: string,
    utcDate: string,
  ): string {
    return this.crypto.hash(
      `${sigilId}:${ip}:${userAgent}:${this.support.dailySalt(utcDate)}`,
    );
  }

  /** Current UTC day bucket, `YYYY-MM-DD`. */
  utcDate(): string {
    return this.support.utcDate();
  }

  /**
   * Normalize an untrusted page path: drop the `?query` and `#fragment`,
   * default an empty path to `/`, and clamp the length. Keeps the path
   * cardinality bounded and avoids persisting query-string secrets.
   */
  normalizePath(path: string | undefined): string {
    const raw = (path ?? "/").split("?")[0]!.split("#")[0]!;
    const trimmed = raw.trim() || "/";
    return trimmed.length > PATH_MAX ? trimmed.slice(0, PATH_MAX) : trimmed;
  }

  /** Resolve whether a sigil's campaign has the `beacon` feature on. */
  async isBeaconFeatureOn(campaignId: number): Promise<boolean> {
    return this.support.isFeatureOn(campaignId, "beacon");
  }

  /**
   * Ingest one pageview from the trusted server-to-server ingest path.
   *
   * Unlike {@link ingestPing}, country and visitor identity come from the
   * request body (stamped by the partner server) rather than being derived
   * server-side from headers/IP. No session-hash derivation is needed: if
   * `visitor` is present it is used as-is as `sessionHash`; if absent the
   * unique-visitor insert is skipped entirely (the partner did not supply
   * identity information).
   *
   * @param sigilId  the resolved sigil id
   * @param path     the raw page path from the partner payload
   * @param country  ISO country code from the partner body; defaults to
   *                 {@link COUNTRY_FALLBACK} when empty or absent
   * @param visitor  the partner-computed daily visitor hash; when absent the
   *                 unique-visitor row is NOT written
   * @param date     UTC day bucket override (for testing); defaults to today
   * @returns `"recorded"` or `"path-capped"`
   */
  async ingestView(
    sigilId: string,
    path: string | undefined,
    country: string | undefined,
    visitor: string | undefined,
    date?: string,
  ): Promise<BeaconIngestOutcome> {
    const utcDate = date ?? this.utcDate();
    const normalizedPath = this.normalizePath(path);
    const safeCountry =
      ((country ?? "") || COUNTRY_FALLBACK).slice(0, COUNTRY_MAX) ||
      COUNTRY_FALLBACK;

    // --- Unique visitor: INSERT OR IGNORE on (sigilId, date, sessionHash).
    // The partner stamps the daily hash; if absent we skip — we have no way
    // to derive it server-side without an IP.
    if (visitor) {
      await this.uniques.query((table, db) =>
        db
          .insert(table)
          .values({ sigilId, date: utcDate, sessionHash: visitor })
          .onConflictDoNothing(),
      );
    }

    // --- Distinct-path cap: same logic as ingestPing.
    const existingView = await this.views.findOne({
      where: {
        sigilId: { eq: sigilId },
        date: { eq: utcDate },
        country: { eq: safeCountry },
        path: { eq: normalizedPath },
      },
    });
    if (!existingView) {
      const known = await this.views.count({
        sigilId: { eq: sigilId },
        date: { eq: utcDate },
        path: { eq: normalizedPath },
      });
      if (known === 0) {
        const rows = await this.database.run(
          sql`
            SELECT COUNT(DISTINCT ${this.views.table.path}) AS paths
            FROM ${this.views.table}
            WHERE ${this.views.table.sigilId} = ${sigilId}
              AND ${this.views.table.date} = ${utcDate}
          `,
          z.object({ paths: z.coerce.number() }),
        );
        const paths = Number(rows[0]?.paths) || 0;
        if (paths >= DISTINCT_PATH_CAP) {
          return "path-capped";
        }
      }
    }

    // --- Pageview aggregate: INSERT … ON CONFLICT DO UPDATE count = count+1.
    await this.views.upsert(
      {
        sigilId,
        date: utcDate,
        country: safeCountry,
        path: normalizedPath,
        count: 1,
      },
      {
        target: ["sigilId", "date", "country", "path"],
        set: { count: sql`${this.views.table.count} + 1` },
      },
    );

    return "recorded";
  }

  /**
   * Ingest one pageview ping for a sigil.
   *
   * @param sigilId    the resolved sigil id
   * @param ping       the (untrusted) pageview payload
   * @param ip         the client IP (resolved from `request.ip`) — used only
   *                   to derive `sessionHash`; NEVER stored.
   * @param userAgent  the client User-Agent — folded into `sessionHash`.
   * @param country    the coarse ISO country code from `cf-ipcountry`.
   * @returns `"recorded"` or `"path-capped"`
   */
  async ingestPing(
    sigilId: string,
    ping: BeaconPingInput,
    ip: string,
    userAgent: string,
    country: string,
  ): Promise<BeaconIngestOutcome> {
    const date = this.utcDate();
    const path = this.normalizePath(ping.path);
    const safeCountry =
      (country || COUNTRY_FALLBACK).slice(0, COUNTRY_MAX) || COUNTRY_FALLBACK;

    // --- Unique visitor: INSERT OR IGNORE on (sigilId, date, sessionHash).
    // A repeat visit from the same visitor that day is a silent no-op. Done
    // before the path cap so the visitor metric stays complete even when a
    // runaway site's view aggregation is being dropped.
    const hash = this.sessionHash(sigilId, ip, userAgent, date);
    await this.uniques.query((table, db) =>
      db
        .insert(table)
        .values({ sigilId, date, sessionHash: hash })
        // INSERT OR IGNORE — a repeat visit from the same visitor today is
        // a silent no-op (the UNIQUE index on the triple absorbs it).
        .onConflictDoNothing(),
    );

    // --- Distinct-path cap: if this path is NEW today and the sigil already
    // has DISTINCT_PATH_CAP distinct paths today, drop the view aggregation.
    const existingView = await this.views.findOne({
      where: {
        sigilId: { eq: sigilId },
        date: { eq: date },
        country: { eq: safeCountry },
        path: { eq: path },
      },
    });
    if (!existingView) {
      // Best-effort under concurrency by design: the distinct-path check
      // below (count → compare to cap → upsert) is a read-modify-write, so
      // two racing requests for two different new paths can both pass the
      // cap and let the sigil briefly exceed DISTINCT_PATH_CAP by a handful
      // of rows. That is acceptable — the cap only bounds runaway growth,
      // not exact cardinality, and the view `count` upsert stays atomic.
      // A path is "known today" if ANY country row exists for it — the cap
      // is on distinct paths, not (country, path) pairs.
      const known = await this.views.count({
        sigilId: { eq: sigilId },
        date: { eq: date },
        path: { eq: path },
      });
      if (known === 0) {
        // Use DatabaseProvider.run — the raw-SQL aggregation path proven on
        // Cloudflare D1 by CampaignStatsController / InsightsController.
        // The previous `Repository.query(() => sql`…`, z.integer())` form
        // returned an EMPTY array on D1 (it works on the in-memory SQLite
        // used by the test suite — hence undetected), so `[{ paths }]`
        // destructured `undefined` and threw, aborting ingestPing before
        // the view upsert. The aggregate is typed `z.string()` and coerced
        // with `Number()` — matching how the Insights controller decodes
        // its COUNT/SUM columns — and `rows[0]?.` guards an empty result.
        const rows = await this.database.run(
          sql`
            SELECT COUNT(DISTINCT ${this.views.table.path}) AS paths
            FROM ${this.views.table}
            WHERE ${this.views.table.sigilId} = ${sigilId}
              AND ${this.views.table.date} = ${date}
          `,
          z.object({ paths: z.coerce.number() }),
        );
        const paths = Number(rows[0]?.paths) || 0;
        if (paths >= DISTINCT_PATH_CAP) {
          return "path-capped";
        }
      }
    }

    // --- Pageview aggregate: INSERT … ON CONFLICT DO UPDATE count = count+1.
    await this.views.upsert(
      {
        sigilId,
        date,
        country: safeCountry,
        path,
        count: 1,
      },
      {
        target: ["sigilId", "date", "country", "path"],
        set: { count: sql`${this.views.table.count} + 1` },
      },
    );

    return "recorded";
  }
}
