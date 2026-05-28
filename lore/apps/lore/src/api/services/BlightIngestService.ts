import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, sql } from "alepha/orm";
import { sigilBlightRate } from "../entities/sigilBlightRate.ts";
import { sigilBlights } from "../entities/sigilBlights.ts";
import { SigilIngestSupport } from "./SigilIngestSupport.ts";

/** A single crash event as supplied by the embed bundle. All fields untrusted. */
export interface BlightEventInput {
  name?: string;
  message?: string;
  stack?: string;
  sourceUrl?: string;
}

/** Outcome of ingesting one event. */
export type BlightIngestOutcome =
  | "recorded" // new fingerprint inserted, or known fingerprint count-bumped
  | "rate-limited"; // dropped: novelty cap reached for this IP today

/** Max stack length stored, in characters. Token-leak + storage bound. */
const STACK_MAX = 4_096;
/** Max distinct NEW fingerprints accepted per IP per UTC day. */
const NOVELTY_CAP = 10;
/** Max hashed IPs retained on a blight row. */
const RECENT_IPS_CAP = 10;
// Storage clamps — mirror the `maxLength` of the matching columns on the
// `sigil_blights` entity (`src/api/entities/sigilBlights.ts`). Keep in sync.
/** Max stored length of the error `name` column. */
const NAME_MAX = 200;
/** Max stored length of the error `message` column. */
const MESSAGE_MAX = 2_000;
/** Max stored length of the `sourceUrl` column. */
const SOURCE_URL_MAX = 2_000;

/**
 * Engine behind `POST /sigils/:id/blights`.
 *
 * Declaring `$repository(...)` here registers `sigil_blights` and
 * `sigil_blight_rate` in the ORM/migration graph (the migration generator
 * scans instantiated repositories — same pattern as `SigilService`).
 *
 * Responsibilities:
 * - sanitize attacker-controlled stack traces (`?query=` strip + 4 KB cap),
 * - compute the stable `sha256` fingerprint,
 * - upsert (`INSERT … ON CONFLICT DO UPDATE count = count + 1`) per event,
 * - enforce the per-IP / per-day NOVELTY rate limit (DB-derived).
 *
 * The rate limit caps *new* fingerprint intake only — a repeat of an
 * already-known fingerprint always bumps `count`, even from a capped IP.
 */
export class BlightIngestService {
  protected crypto = $inject(CryptoProvider);
  protected dateTime = $inject(DateTimeProvider);
  protected support = $inject(SigilIngestSupport);
  protected blights = $repository(sigilBlights);
  protected blightRate = $repository(sigilBlightRate);

  /**
   * Whether the bot-UA noise filter should be skipped entirely. Delegates
   * to {@link SigilIngestSupport.isBotCheckDisabled} (the `DISABLE_BOT_CHECK`
   * env escape hatch is shared across the whole ingestion surface).
   */
  isBotCheckDisabled(): boolean {
    return this.support.isBotCheckDisabled();
  }

  /**
   * Sanitize an attacker-controlled stack trace:
   * - strip `?query=…` (and `#fragment`) from every frame URL — auth tokens
   *   routinely ride in query strings and must never be persisted,
   * - truncate the whole blob at {@link STACK_MAX} characters.
   */
  sanitizeStack(stack: string | undefined): string {
    if (!stack) return "";
    // Strip query + fragment from any http(s) URL appearing in a frame.
    const stripped = stack.replace(/(https?:\/\/[^\s?#)]+)[?#][^\s)]*/g, "$1");
    return stripped.length > STACK_MAX
      ? stripped.slice(0, STACK_MAX)
      : stripped;
  }

  /**
   * `sha256(errorName + ":" + throwSiteFrame + ":" + sigilId)`.
   *
   * Stable across incidents of the same root cause (the first stack frame
   * is the throw site) and scoped to the sigil so two campaigns embedding
   * the same library never collide.
   *
   * The stack-line component is the first V8 throw-site frame — the first
   * line matching `/^\s*at\s/`. The header line of a V8 trace
   * (`ErrorName: message`) embeds the volatile error *message* (interpolated
   * ids, URLs, `x` vs `y`), so fingerprinting on it would fragment one root
   * cause into many blights and defeat dedup. When no `at ` frame exists
   * (non-V8 trace, or an empty stack) we fall back to the first non-empty
   * line so the fingerprint stays stable.
   */
  fingerprint(name: string, stack: string, sigilId: string): string {
    const lines = stack.split("\n");
    const throwSiteFrame =
      lines.find((l) => /^\s*at\s/.test(l)) ??
      lines.find((l) => l.trim() !== "") ??
      "";
    return this.crypto.hash(
      `${name}:${this.normalizeFrame(throwSiteFrame)}:${sigilId}`,
    );
  }

  /**
   * Strip volatile bits from a stack frame so the fingerprint stays stable
   * across deploys. Bundlers (Vite/Webpack) emit content-hashed filenames
   * like `entry.iHryQ0pA.js` and the exact `:line:col` shifts whenever the
   * bundle is rebuilt — without normalizing, every deploy spawns a brand-new
   * blight for the same root cause.
   *
   * - `name.<hash>.ext` → `name.ext` (hash = 6+ alphanumerics between dots)
   * - trailing `:line:col` or `:line` stripped
   */
  private normalizeFrame(frame: string): string {
    return frame
      .trim()
      .replace(/\.[A-Za-z0-9_-]{6,}\.(m?js|css)\b/g, ".$1")
      .replace(/:\d+(?::\d+)?(?=\)?$)/g, "");
  }

  /**
   * `sha256(ip + daily_salt)` — never a raw IP. The daily salt comes from
   * the shared {@link SigilIngestSupport.dailySalt}; the `(ip, salt)` tuple
   * is Blights-specific so the hash itself stays here.
   */
  hashIp(ip: string, utcDate: string): string {
    return this.crypto.hash(`${ip}:${this.support.dailySalt(utcDate)}`);
  }

  /** Current UTC day bucket, `YYYY-MM-DD`. */
  utcDate(): string {
    return this.support.utcDate();
  }

  /** Resolve whether a sigil's campaign has the `blights` feature on. */
  async isBlightsFeatureOn(campaignId: number): Promise<boolean> {
    return this.support.isFeatureOn(campaignId, "blights");
  }

  /**
   * Ingest one crash event for a sigil.
   *
   * @param sigilId   the resolved sigil id
   * @param event     the (untrusted) crash payload
   * @param ip        the client IP (already resolved from `request.ip`)
   * @returns `"recorded"` or `"rate-limited"`
   */
  async ingestEvent(
    sigilId: string,
    event: BlightEventInput,
    ip: string,
  ): Promise<BlightIngestOutcome> {
    const now = this.dateTime.nowISOString();
    const date = this.utcDate();
    const ipHash = this.hashIp(ip, date);

    const name = (event.name ?? "Error").slice(0, NAME_MAX);
    const message = (event.message ?? "").slice(0, MESSAGE_MAX);
    const stack = this.sanitizeStack(event.stack);
    const sourceUrl = (event.sourceUrl ?? "").slice(0, SOURCE_URL_MAX);
    const fingerprint = this.fingerprint(name, stack, sigilId);

    // Is this fingerprint already known for this sigil?
    const existing = await this.blights.findOne({
      where: { sigilId: { eq: sigilId }, fingerprint: { eq: fingerprint } },
    });

    // Novelty gate — only a BRAND-NEW fingerprint can be rate-limited.
    if (!existing) {
      const rateRow = await this.blightRate.findOne({
        where: {
          sigilId: { eq: sigilId },
          ipHash: { eq: ipHash },
          date: { eq: date },
        },
      });
      // Best-effort under concurrency by design: the `fingerprints` (and
      // `recentIps` below) array merges are read-modify-write, so a racing
      // request for the same new fingerprint can lose an array entry. That
      // is acceptable noise data — the blight `count` stays atomic via the
      // `ON CONFLICT DO UPDATE` upsert.
      const seen = rateRow?.fingerprints ?? [];
      if (!seen.includes(fingerprint)) {
        if (seen.length >= NOVELTY_CAP) {
          // This IP has discovered its daily quota of new blights — drop
          // just this event. Throughput of KNOWN blights is unaffected.
          return "rate-limited";
        }
        await this.blightRate.upsert(
          {
            sigilId,
            ipHash,
            date,
            fingerprints: [...seen, fingerprint],
          },
          {
            target: ["sigilId", "ipHash", "date"],
            set: { fingerprints: [...seen, fingerprint] },
          },
        );
      }
    }

    // Upsert the blight. One atomic INSERT … ON CONFLICT DO UPDATE:
    // a known fingerprint bumps count + lastSeenAt; a new one inserts.
    const nextIps = this.mergeRecentIps(existing?.recentIps ?? [], ipHash);
    await this.blights.upsert(
      {
        sigilId,
        fingerprint,
        name,
        message,
        stack,
        sourceUrl,
        firstSeenAt: now,
        lastSeenAt: now,
        count: 1,
        recentIps: nextIps,
        status: "open",
      },
      {
        target: ["sigilId", "fingerprint"],
        set: {
          count: sql`${this.blights.table.count} + 1`,
          lastSeenAt: now,
          message,
          stack,
          sourceUrl,
          recentIps: nextIps,
        },
      },
    );

    return "recorded";
  }

  /** Append a hashed IP, dedup, keep the most-recent {@link RECENT_IPS_CAP}. */
  protected mergeRecentIps(current: string[], ipHash: string): string[] {
    const without = current.filter((h) => h !== ipHash);
    return [...without, ipHash].slice(-RECENT_IPS_CAP);
  }
}
