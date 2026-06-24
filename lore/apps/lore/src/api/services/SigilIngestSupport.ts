import { $env, $inject, z } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { campaigns } from "../entities/campaigns.ts";

/**
 * Shared infrastructure for the Sigils ingestion services
 * ({@link BlightIngestService}, {@link BeaconIngestService}).
 *
 * Both ingestion engines need the exact same support: the daily-rotating
 * salt, the UTC day bucket, the bot-check escape hatch, and a campaign
 * feature lookup. Rather than copy-paste that infrastructure (and its env
 * declaration + doc comments) into each engine, it lives here once and is
 * `$inject`ed into both — composition over inheritance, matching how the
 * rest of the Lore services compose (`QuestImportFormatProvider`,
 * `FeaturePaywallService`).
 *
 * What stays per-service: the actual hashing tuples — `BlightIngestService`
 * hashes `(ip, salt)` for IP fingerprints, `BeaconIngestService` hashes
 * `(sigilId, ip, userAgent, salt)` for the `sessionHash`. Their inputs
 * differ, so only the shared {@link dailySalt} / {@link utcDate} primitives
 * are pulled up; the per-service hashes call into them.
 */
export class SigilIngestSupport {
  protected crypto = $inject(CryptoProvider);
  protected dateTime = $inject(DateTimeProvider);
  protected campaigns = $repository(campaigns);

  /**
   * Env knobs shared by the whole Sigils ingestion surface.
   *
   * - `SIGIL_IP_SALT` — optional secret folded into the daily salt. When
   *   unset, a constant fallback is used — the salt still rotates per UTC
   *   day, which is what makes derived hashes non-cross-day-linkable; the
   *   secret only raises the bar against an attacker brute-forcing an IP
   *   from a known hash. One salt knob for the whole ingestion surface
   *   (Blights IP-hashes + Beacons `sessionHash`).
   * - `DISABLE_BOT_CHECK` — escape hatch that, when truthy, makes the
   *   bot-UA filter a no-op so the ingestion loader skips it entirely.
   *   Exists for tests/debugging and for environments where the bot list
   *   causes false negatives (a real user dropped as a crawler). Mirrors
   *   Umami's `DISABLE_BOT_CHECK`. The UA filter is only a noise filter,
   *   never a security boundary, so disabling it loses nothing but inbox
   *   tidiness.
   */
  protected env = $env(
    z.object({
      SIGIL_IP_SALT: z.text().optional(),
      DISABLE_BOT_CHECK: z.text().optional(),
    }),
  );

  /**
   * Whether the bot-UA noise filter should be skipped entirely. Driven by
   * the `DISABLE_BOT_CHECK` env escape hatch — truthy ("1"/"true"/any
   * non-empty value other than "0"/"false") turns the filter off.
   */
  isBotCheckDisabled(): boolean {
    const raw = this.env.DISABLE_BOT_CHECK?.trim().toLowerCase();
    return !!raw && raw !== "0" && raw !== "false";
  }

  /**
   * Per-UTC-day salt. Derived (not stored) so it rotates automatically and
   * survives restarts identically across workers.
   *
   * The fallback secret (`"lore-sigil"`) is feature-neutral on purpose —
   * this salt feeds both the Blights IP-hash and the Beacons `sessionHash`.
   * It is opaque and daily-rotating; the literal only matters as a tie
   * across environments without `SIGIL_IP_SALT`, never to callers.
   */
  dailySalt(utcDate: string): string {
    const secret = this.env.SIGIL_IP_SALT ?? "lore-sigil";
    return this.crypto.hash(`${secret}:${utcDate}`);
  }

  /** Current UTC day bucket, `YYYY-MM-DD`. */
  utcDate(): string {
    return new Date(this.dateTime.nowMillis()).toISOString().slice(0, 10);
  }

  /**
   * Resolve whether a sigil's campaign has the given feature toggled on.
   *
   * @param campaignId  the sigil's owning campaign
   * @param featureKey  the `campaign.features` key (`"sigils"`,
   *   `"petitions"`, `"blights"`, `"beacon"`, `"vitals"`)
   */
  async isFeatureOn(
    campaignId: number,
    featureKey: "sigils" | "petitions" | "blights" | "beacon" | "vitals",
  ): Promise<boolean> {
    const campaign = await this.campaigns.findOne({
      where: { id: { eq: campaignId } },
    });
    return !!campaign?.features?.[featureKey];
  }
}
