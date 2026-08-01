import type { SigilForwarded } from "@alepha/sigil/envelope";
import { sigilFingerprintSource } from "@alepha/sigil/fingerprint";
import { bucketIndex, type VitalMetric } from "@alepha/sigil/vitals";
import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, sql } from "alepha/orm";
import { blights } from "../entities/blights.ts";
import { sigilErrorGroups } from "../entities/sigilErrorGroups.ts";
import { type Sigil, type SigilKind, sigils } from "../entities/sigils.ts";
import { sigilUniquesDaily } from "../entities/sigilUniquesDaily.ts";
import { sigilViewsHourly } from "../entities/sigilViewsHourly.ts";
import { sigilVitalsHourly } from "../entities/sigilVitalsHourly.ts";
import { BlightRuleService } from "./BlightRuleService.ts";

/**
 * Turns one sigil envelope into rows.
 *
 * Everything here is an upsert into a bucket, never an append of an event. That
 * is the whole storage strategy: what an operator asks of this data is always
 * an aggregate ("how many", "how often", "how bad"), and computing aggregates
 * from retained events costs more every day the app succeeds.
 *
 * ## Errors are written twice, on purpose
 *
 * `sigil_error_groups` dedups on `(sigilId, fingerprint)` and `blights` on
 * `(campaignId, fingerprint)`, and both are written for every accepted error.
 * They are not two copies of one thing — they answer two different questions:
 *
 * - *"Is this still happening in production?"* is per environment, because a
 *   sigil is an environment and an error budget shared between staging and
 *   production is nobody's budget. That is `sigil_error_groups`.
 * - *"Have we decided what to do about this bug?"* is one decision per bug, not
 *   one per place it was seen. An inbox that lists the same `TypeError` twice
 *   because staging has it too is a worse inbox, and `blights.status` — open,
 *   resolved, `quest:<id>` — is exactly the kind of state that must not fork.
 *   That is `blights`.
 *
 * So the counts differ by design: a group's `count` is what that environment
 * saw, a blight's `count` is the campaign-wide total, which is the right sort
 * key for triage by blast radius. `blights.sigilId` records the **most recent**
 * reporter, which is what the inbox's "filter by sigil" dropdown means; the
 * per-environment breakdown lives in the groups, where it is not lossy.
 *
 * `sigil_error_groups.forwardedAt` is stamped on every sync, so a group always
 * carries the last time it contributed to the inbox.
 */
export class SigilIngestService {
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly rules = $inject(BlightRuleService);

  protected readonly sigils = $repository(sigils);
  protected readonly views = $repository(sigilViewsHourly);
  protected readonly uniques = $repository(sigilUniquesDaily);
  protected readonly vitals = $repository(sigilVitalsHourly);
  protected readonly errorGroups = $repository(sigilErrorGroups);
  protected readonly blights = $repository(blights);

  /**
   * Absorbs one batch.
   *
   * Each section is gated on the capability the sigil was issued with, not on
   * the campaign's current toggles: the token's own scope is the authorization
   * boundary, and it is the one thing a request carries with it. The campaign
   * toggles are what `GET /sigils/config` reports, so an app stops sending at
   * the source rather than having its payload silently discarded here.
   *
   * `lastSeenAt` is stamped whatever happens, including for a batch every gate
   * rejected. It answers "did this environment report", which is Lore's own
   * bookkeeping — the app never sends a liveness signal of its own, and this
   * is deliberately not one: an app that reports nothing is silent here too.
   */
  async absorb(sigil: Sigil, envelope: SigilForwarded): Promise<void> {
    const now = new Date(this.dateTime.nowMillis()).toISOString();

    if (envelope.errors?.length && this.carries(sigil, "blights")) {
      await this.absorbErrors(sigil, envelope.errors, now);
    }
    if (envelope.views?.length && this.carries(sigil, "beacon")) {
      await this.absorbViews(
        sigil,
        envelope.views,
        envelope.country,
        envelope.visitor,
        now,
      );
    }
    if (envelope.vitals?.length && this.carries(sigil, "vitals")) {
      await this.absorbVitals(sigil, envelope.vitals, now);
    }

    await this.sigils.updateById(sigil.id, { lastSeenAt: now });
  }

  /**
   * Merges errors into their per-environment group, then into the campaign's
   * triage inbox.
   *
   * `count` comes from the sender, which has already collapsed a window's worth
   * of identical failures. Adding it rather than incrementing by one is what
   * keeps a crash loop's real magnitude visible without storing it.
   *
   * Ignore rules are applied once, before either write. Filtering on read would
   * let a muted error keep growing both tables and keep inflating every count.
   */
  protected async absorbErrors(
    sigil: Sigil,
    errors: NonNullable<SigilForwarded["errors"]>,
    now: string,
  ): Promise<void> {
    const ignoreRules = await this.rules.listForCampaign(sigil.campaignId);

    for (const error of errors) {
      if (this.rules.matches(error.message, ignoreRules)) {
        continue;
      }

      // Hashed from the shared source string, so the group this lands in is the
      // same one the sender aggregated under.
      const fingerprint = this.crypto.hash(
        sigilFingerprintSource(error.name, error.stack),
      );
      const seen = error.count ?? 1;
      const origin = error.origin ?? "client";
      const name = this.errorName(error.name);

      await this.errorGroups.upsert(
        {
          sigilId: sigil.id,
          fingerprint,
          name,
          message: error.message,
          stackSample: error.stack,
          sourceUrl: error.sourceUrl,
          origin,
          firstSeenAt: now,
          lastSeenAt: now,
          count: seen,
          forwardedAt: now,
        },
        {
          target: ["sigilId", "fingerprint"],
          // Only the count and the last sighting move. `stackSample` and
          // `firstSeenAt` deliberately do not: the newest sample of a recurring
          // error is rarely the informative one, and letting it drift means the
          // stored stack stops matching the stored first sighting.
          set: {
            count: sql`${this.errorGroups.table.count} + ${seen}`,
            lastSeenAt: now,
            forwardedAt: now,
          },
        },
      );

      await this.blights.upsert(
        {
          campaignId: sigil.campaignId,
          sigilId: sigil.id,
          fingerprint,
          name,
          message: error.message,
          stack: error.stack,
          sourceUrl: error.sourceUrl,
          origin,
          firstSeenAt: now,
          lastSeenAt: now,
          count: seen,
        },
        {
          target: ["campaignId", "fingerprint"],
          set: {
            count: sql`${this.blights.table.count} + ${seen}`,
            lastSeenAt: now,
            // Which environment reported it last. Deliberately overwritten:
            // "still happening, most recently over there" is the useful fact
            // for triage, and the per-environment split is kept in full by
            // `sigil_error_groups`.
            sigilId: sigil.id,
          },
        },
      );
    }
  }

  protected async absorbViews(
    sigil: Sigil,
    views: NonNullable<SigilForwarded["views"]>,
    country: string | undefined,
    visitor: string | undefined,
    now: string,
  ): Promise<void> {
    const hour = this.hourBucket(now);
    const day = this.dayBucket(now);

    for (const view of views) {
      // `INSERT … ON CONFLICT DO UPDATE count = count + 1`, in one statement.
      // Reading then writing would lose views under concurrency, which is
      // exactly the load this table exists to measure.
      await this.views.upsert(
        {
          sigilId: sigil.id,
          hour,
          path: this.normalizePath(view.path),
          // `||`, not `??`: the wire schema allows an empty string and the
          // column is `min(1)`, so a proxy that stamps `country: ""` rather
          // than omitting the field would 500 the whole batch.
          country: country || "ZZ",
          count: 1,
        },
        {
          target: ["sigilId", "hour", "path", "country"],
          set: { count: sql`${this.views.table.count} + 1` },
        },
      );
    }

    // One row per visitor per day. Recorded once per batch rather than per
    // view: the same person loading ten pages is one unique.
    if (visitor) {
      // The conflict IS the expected case — a returning visitor. Upserting with
      // the day set to itself makes it a no-op instead of an error.
      await this.uniques.upsert(
        { sigilId: sigil.id, day, visitorHash: visitor },
        { target: ["sigilId", "day", "visitorHash"], set: { day } },
      );
    }
  }

  protected async absorbVitals(
    sigil: Sigil,
    vitals: NonNullable<SigilForwarded["vitals"]>,
    now: string,
  ): Promise<void> {
    const hour = this.hourBucket(now);

    for (const vital of vitals) {
      const path = this.normalizePath(vital.path);
      // Boundaries come from the package, so the chart and the ingest agree on
      // what "good" means without either side restating it.
      const bucket = String(
        bucketIndex(vital.metric as VitalMetric, vital.value),
      );

      // Read-modify-write, unlike the other buckets: the histogram lives inside
      // a JSON column, so there is no column to increment. Two samples for the
      // same (hour, metric, path) landing together can lose one — acceptable
      // for a distribution, where one sample in a bucket of many changes
      // nothing an operator would read differently.
      const existing = await this.vitals.findOne({
        where: {
          sigilId: { eq: sigil.id },
          hour: { eq: hour },
          metric: { eq: vital.metric },
          path: { eq: path },
        },
      });
      const counts: Record<string, number> = {
        ...((existing?.bucketCounts ?? {}) as Record<string, number>),
      };
      counts[bucket] = (counts[bucket] ?? 0) + 1;

      await this.vitals.upsert(
        {
          sigilId: sigil.id,
          hour,
          metric: vital.metric,
          path,
          bucketCounts: counts,
        },
        {
          target: ["sigilId", "hour", "metric", "path"],
          set: { bucketCounts: counts },
        },
      );
    }
  }

  /**
   * Whether this sigil was issued the capability a section needs.
   *
   * `SigilKind`, not `string`: a typo here does not throw, it silently
   * disables that capability for every sigil forever, and the only symptom is
   * a table that stays empty. The compiler is the only thing that catches it.
   */
  protected carries(sigil: Sigil, kind: SigilKind): boolean {
    return (sigil.kinds ?? []).includes(kind);
  }

  /**
   * A non-empty name for an error group.
   *
   * The wire schema allows an empty `name` and the group's does not — an error
   * thrown as a bare string arrives with nothing there. It still has to be
   * storable, and it still has to fingerprint to the same value the sender
   * used, so the substitution happens on the way to storage only.
   */
  protected errorName(name: string): string {
    return name.trim() || "Error";
  }

  /**
   * Strips query and fragment.
   *
   * Without it, `/search?q=…` makes every distinct query its own row, and the
   * table's storage stops being bounded by page cardinality — which is the
   * property that makes rolling up on write affordable.
   */
  protected normalizePath(path: string): string {
    return path.split(/[?#]/)[0].slice(0, 1024) || "/";
  }

  /**
   * `YYYY-MM-DDTHH`, UTC.
   */
  protected hourBucket(at: string): string {
    return at.slice(0, 13);
  }

  /**
   * `YYYY-MM-DD`, UTC.
   */
  protected dayBucket(at: string): string {
    return at.slice(0, 10);
  }
}
