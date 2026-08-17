import type { SigilConfig } from "@alepha/sigil/config";
import type { SigilForwarded } from "@alepha/sigil/envelope";
import { sigilFingerprintSource } from "@alepha/sigil/fingerprint";
import { sigilScrubUrl } from "@alepha/sigil/scrub";
import { bucketIndex, type VitalMetric } from "@alepha/sigil/vitals";
import { $inject, Alepha } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, sql } from "alepha/orm";
import { blights } from "../entities/blights.ts";
import { LoreAnalytics } from "../entities/loreAnalytics.ts";
import { projects } from "../entities/projects.ts";
import { sigilErrorGroups } from "../entities/sigilErrorGroups.ts";
import { type Sigil, type SigilKind, sigils } from "../entities/sigils.ts";
import { BlightRuleService } from "./BlightRuleService.ts";
import { LoreAnalyticsStore } from "./LoreAnalyticsStore.ts";

/**
 * What one sigil is allowed to write, right now.
 *
 * The sigil's own kinds under the project's `sigils` master switch — and, for
 * `feedback` alone, the project's `feedback` flag on top. The three project
 * flags that used to be intersected in as well are retired; see
 * {@link SigilIngestService.gatesFor}, which is the definition this interface
 * only names.
 *
 * One answer for both the gate `absorb` applies and the answer
 * `GET /sigils/config` serves, so those two can never drift into disagreeing
 * about what the sink accepts.
 */
export interface SigilGates {
  views: boolean;
  errors: boolean;
  vitals: boolean;
  feedback: boolean;
}

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
 * `(projectId, fingerprint)`, and both are written for every accepted error.
 * They are not two copies of one thing — they answer two different questions:
 *
 * - *"Is this still happening over there?"* is per sigil, because an error
 *   budget shared across every app reporting into a project is nobody's budget.
 *   That is `sigil_error_groups`.
 * - *"Have we decided what to do about this bug?"* is one decision per bug, not
 *   one per place it was seen. An inbox that lists the same `TypeError` twice
 *   because a second app has it too is a worse inbox, and `blights.status` —
 *   open, resolved, `quest:<id>` — is exactly the kind of state that must not
 *   fork. That is `blights`.
 *
 * So the counts differ by design: a group's `count` is what that app saw, a
 * blight's `count` is the project-wide total, which is the right sort key for
 * triage by blast radius. `blights.sigilId` records the **most recent**
 * reporter, which is what the inbox's "filter by sigil" dropdown means; the
 * per-app breakdown lives in the groups, where it is not lossy.
 */
export class SigilIngestService {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly rules = $inject(BlightRuleService);

  /**
   * Uniques only. `LoreAnalyticsStore` used to hold views and vitals too,
   * behind the now-deleted `AnalyticsStore` interface from
   * `@alepha/sigil/ingest` — see that class's doc for why a distinct visitor
   * count is the one question storage-swappable `$analytics()` datasets
   * cannot answer, and so is the one thing that stayed on a repository.
   * Error groups and blights stay on repositories for an unrelated reason:
   * they keep the *first* stack sample, which needs a read before every
   * write, something an append-only analytics backend cannot do.
   */
  protected readonly analytics = $inject(LoreAnalyticsStore);

  /**
   * Where views and vitals actually live: the portable `$analytics()`
   * datasets declared on `LoreAnalytics`. This was a dual-write mirror
   * alongside the legacy `sigilViewsHourly` / `sigilVitalsHourly` tables
   * while `InsightsController` still read from those tables; now that it
   * reads from these datasets instead, this is the only write for both.
   */
  protected readonly datasets = $inject(LoreAnalytics);

  protected readonly projects = $repository(projects);
  protected readonly sigils = $repository(sigils);
  protected readonly errorGroups = $repository(sigilErrorGroups);
  protected readonly blights = $repository(blights);

  /**
   * Absorbs one batch.
   *
   * Every section is gated on {@link gatesFor}: Blights, Beacon and Vitals on
   * the project's `sigils` master switch and the sigil's own kinds; Feedback
   * additionally on the project's `feedback` flag. Enforcing here, not just
   * advertising via `GET /sigils/config`, matters because the reporting client
   * fails open on any config error — a well-behaved app stops sending at the
   * source, but this is the backstop, not a replacement for it.
   *
   * `lastSeenAt` is stamped whatever happens, including for a batch every gate
   * rejected. It answers "did this app report", which is Lore's own
   * bookkeeping — the app never sends a liveness signal of its own, and this
   * is deliberately not one: an app that reports nothing is silent here too.
   */
  async absorb(sigil: Sigil, envelope: SigilForwarded): Promise<void> {
    const now = new Date(this.dateTime.nowMillis()).toISOString();
    const gates = await this.gatesFor(sigil);

    if (envelope.errors?.length && gates.errors) {
      await this.absorbErrors(sigil, envelope.errors, now);
    }
    if (envelope.views?.length && gates.views) {
      await this.absorbViews(
        sigil,
        envelope.views,
        envelope.country,
        envelope.visitor,
        now,
      );
    }
    if (envelope.vitals?.length && gates.vitals) {
      await this.absorbVitals(sigil, envelope.vitals, now);
    }

    await this.sigils.updateById(sigil.id, { lastSeenAt: now });
  }

  /**
   * What this sigil may report.
   *
   * Answered in one place because it is one decision asked in two: here on
   * write, and by `GET /sigils/config` on read. Stating it twice is how a sink
   * ends up advertising a capability it then discards.
   *
   * Blights, Beacon and Vitals are **the sigil's own decision**, under the
   * project's `sigils` master switch. They used to be intersected with
   * project-level feature flags as well, because `kinds` had no update path and
   * an owner needed some lever — but that lever applied to every enrolled app
   * at once. `SigilController.updateSigil` is now that lever, per app, and the
   * three project flags are retired.
   *
   * Feedback is the exception and stays project-gated: `features.feedback` also
   * governs the first-party form at `/p/:projectId/request`, which exists with
   * no app enrolled at all.
   *
   * A sigil whose project is gone reports nothing. It cannot normally happen —
   * `sigils.projectId` cascades — but answering "everything on" to a token with
   * no project behind it is the wrong default.
   */
  async gatesFor(sigil: Sigil): Promise<SigilGates> {
    const project = await this.projects.findOne({
      where: { id: { eq: sigil.projectId } },
    });

    const features = project?.features;
    const master = features?.sigils === true;

    return {
      views: master && this.carries(sigil, "beacon"),
      errors: master && this.carries(sigil, "blights"),
      vitals: master && this.carries(sigil, "vitals"),
      feedback:
        master &&
        features?.feedback === true &&
        this.carries(sigil, "feedback"),
    };
  }

  /**
   * The standing answer to "how much should I send" — what `GET /sigils/config`
   * returns, built here rather than in the route.
   *
   * Because there are two callers now: that route, and the in-process provider
   * Lore substitutes to report to itself (a Worker cannot fetch its own
   * hostname). Two constructions of the same answer is how they drift, which is
   * the failure the shared `@alepha/sigil/paths` already had to fix once.
   *
   * `sampling` is deliberately absent: Lore has no per-project rate to tune,
   * and the client already defaults to keeping everything.
   */
  async configFor(sigil: Sigil): Promise<SigilConfig> {
    const gates = await this.gatesFor(sigil);
    const publicUrl = String(this.alepha.env.PUBLIC_URL ?? "").replace(
      /\/$/,
      "",
    );
    // The feedback form is addressed by the project's slug, not its id, so the
    // row is needed here as well as inside `gatesFor`. Read once and reused
    // below rather than threaded through the gates, which are a boolean set
    // and have no business carrying a URL fragment.
    const project = gates.feedback
      ? await this.projects.findOne({ where: { id: { eq: sigil.projectId } } })
      : undefined;

    return {
      enabled: {
        views: gates.views,
        errors: gates.errors,
        vitals: gates.vitals,
      },
      // Omitted rather than empty when the module is off: the client treats an
      // absent url as "no feedback surface", which is the honest reading.
      ...(gates.feedback && project?.slug
        ? {
            // ⚠️ This value crosses the wire into third-party apps, which render
            // it as their own "report a bug" link. It is re-fetched on every
            // config poll, so a deploy self-heals — but an app that cached the
            // old `/p/:id/request` shape has a dead link, and a project rename
            // breaks it the same way it breaks a bookmark.
            feedbackUrl: `${publicUrl}/${project.slug}/request`,
            // Only when the app has actually chosen one. Sending the default
            // explicitly would make "never configured" indistinguishable from
            // "deliberately bottom-right", and both already resolve the same
            // way client-side.
            ...(sigil.feedbackPosition
              ? { feedbackPosition: sigil.feedbackPosition }
              : {}),
          }
        : {}),
    };
  }

  /**
   * Merges errors into their per-app group, then into the project's
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
    const ignoreRules = await this.rules.listForProject(sigil.projectId);

    // Two statements for the whole envelope rather than two per error. Against
    // D1 an `await` is a network round-trip, not a function call, so the old
    // serial loop cost `2n + 1` of them and measured ~1.0-1.6s of wall time per
    // ingest against ~10ms of CPU — the request was almost entirely spent
    // waiting. The envelope caps `errors` at 20, so one statement per table is
    // always enough and there is nothing here to chunk.
    const folded = this.foldByFingerprint(errors, ignoreRules);
    if (folded.length === 0) {
      return;
    }

    await this.errorGroups.upsertMany(
      folded.map((error) => ({
        sigilId: sigil.id,
        fingerprint: error.fingerprint,
        name: error.name,
        message: error.message,
        stackSample: error.stack,
        sourceUrl: error.sourceUrl,
        origin: error.origin,
        firstSeenAt: now,
        lastSeenAt: now,
        count: error.count,
      })),
      {
        target: ["sigilId", "fingerprint"],
        // Only the count and the last sighting move. `stackSample` and
        // `firstSeenAt` deliberately do not: the newest sample of a recurring
        // error is rarely the informative one, and letting it drift means the
        // stored stack stops matching the stored first sighting.
        //
        // The increment reads `excluded`, not a captured number: one `set`
        // clause serves every row in the batch, so `+ ${seen}` would add one
        // row's count to all of them. `excluded` is the row being inserted.
        set: {
          count: sql`${this.errorGroups.table.count} + excluded.count`,
          lastSeenAt: now,
        },
      },
    );

    await this.blights.upsertMany(
      folded.map((error) => ({
        projectId: sigil.projectId,
        sigilId: sigil.id,
        fingerprint: error.fingerprint,
        name: error.name,
        message: error.message,
        stack: error.stack,
        sourceUrl: error.sourceUrl,
        origin: error.origin,
        firstSeenAt: now,
        lastSeenAt: now,
        count: error.count,
      })),
      {
        target: ["projectId", "fingerprint"],
        set: {
          count: sql`${this.blights.table.count} + excluded.count`,
          lastSeenAt: now,
          // Which app reported it last. Deliberately overwritten:
          // "still happening, most recently over there" is the useful fact
          // for triage, and the per-app split is kept in full by
          // `sigil_error_groups`.
          sigilId: sigil.id,
        },
      },
    );
  }

  /**
   * Accepted errors reduced to one row per fingerprint, counts summed.
   *
   * ⚠️ **Not an optimisation — `upsertMany` requires it.** Two rows with the
   * same conflict target in one statement is a case the engines disagree on:
   * Postgres refuses outright, SQLite quietly applies them in sequence. Two
   * reports can share a fingerprint whenever they share a `name` and `stack`,
   * which is precisely what a fingerprint is hashed from, so this is ordinary
   * input rather than a corner case.
   *
   * The fold reproduces what the serial upsert loop did row by row: the first
   * occurrence supplies the descriptive fields and later ones contribute only
   * their count. That is the same precedence a conflicting `set` gives an
   * already-stored row, so a batch behaves identically whether its fingerprint
   * was seen a moment ago in this envelope or an hour ago in another.
   */
  protected foldByFingerprint(
    errors: NonNullable<SigilForwarded["errors"]>,
    ignoreRules: Awaited<ReturnType<BlightRuleService["listForProject"]>>,
  ): FoldedError[] {
    const folded = new Map<string, FoldedError>();

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

      const already = folded.get(fingerprint);
      if (already) {
        already.count += seen;
        continue;
      }

      folded.set(fingerprint, {
        fingerprint,
        name: this.errorName(error.name),
        message: error.message,
        stack: error.stack,
        // `sourceUrl` is scrubbed at the source too, in the reporting package.
        // Repeating it here is not belt-and-braces: a browser bundle and the
        // sink it reports to deploy independently, so every app that has not
        // yet taken the upgrade is still sending `location.href` with its query
        // string — and this is the last point before it lands somewhere every
        // project member can read and the retention sweep will not reclaim.
        sourceUrl: sigilScrubUrl(error.sourceUrl),
        origin: error.origin ?? "client",
        count: seen,
      });
    }

    return [...folded.values()];
  }

  protected async absorbViews(
    sigil: Sigil,
    views: NonNullable<SigilForwarded["views"]>,
    country: string | undefined,
    visitor: string | undefined,
    now: string,
  ): Promise<void> {
    const day = this.dayBucket(now);

    // Folded before the write, not just for speed: the store turns a batch
    // into ONE statement, one `ON CONFLICT` clause, and Postgres refuses to
    // touch the same row twice inside one. Folding is what makes the batch
    // both legal and correct — each bucket has to carry its own count,
    // because the store's SET clause adds `excluded` rather than a literal 1.
    const buckets = new Map<
      string,
      { hour: string; path: string; country: string; count: number }
    >();
    for (const view of views) {
      const hour = this.hourBucket(this.eventTime(view.ts, now));
      const path = this.normalizePath(view.path);
      // `||`, not `??`: the wire schema allows an empty string and the
      // column is `min(1)`, so a proxy that stamps `country: ""` rather
      // than omitting the field would 500 the whole batch.
      const iso = country || "ZZ";
      const key = `${hour}|${path}|${iso}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.count += 1;
      } else {
        buckets.set(key, { hour, path, country: iso, count: 1 });
      }
    }

    await this.analytics.absorb({
      // One row per visitor per day. Recorded once per batch rather than per
      // view: the same person loading ten pages is one unique. `views` has no
      // counterpart here anymore — it stays bespoke, see `LoreAnalyticsStore`'s
      // class doc.
      uniques: visitor
        ? [{ sigilId: sigil.id, day, visitorHash: visitor }]
        : [],
    });

    // The only write for `sigil_views` — `InsightsController` reads it back
    // through the same `LoreAnalytics` declaration. Unlike the uniques write
    // above, nothing catches a failure here: there is no other copy of this
    // batch to fall back on, so a throw is real data loss and has to surface
    // as one, not be swallowed the way the now-deleted dual-write mirror did.
    await this.datasets.views.recordMany(
      [...buckets.values()].map((bucket) => ({
        sigilId: sigil.id,
        path: bucket.path,
        country: bucket.country,
        count: bucket.count,
        hour: bucket.hour,
      })),
    );
  }

  protected async absorbVitals(
    sigil: Sigil,
    vitals: NonNullable<SigilForwarded["vitals"]>,
    now: string,
  ): Promise<void> {
    // Fold the batch into one sample per `(hour, metric, path, bucket)`. Same
    // two reasons as views: one statement carries one `ON CONFLICT` clause and
    // Postgres refuses duplicate conflict targets inside it, and the
    // increments have to add up.
    const samples = new Map<
      string,
      {
        hour: string;
        metric: VitalMetric;
        path: string;
        bucket: number;
        count: number;
      }
    >();

    for (const vital of vitals) {
      const hour = this.hourBucket(this.eventTime(vital.ts, now));
      const path = this.normalizePath(vital.path);
      // Boundaries come from the package, so the chart and the ingest agree on
      // what "good" means without either side restating it.
      const metric = vital.metric as VitalMetric;
      const bucket = bucketIndex(metric, vital.value);

      const key = `${hour}|${metric}|${path}|${bucket}`;
      const sample = samples.get(key);
      if (sample) sample.count += 1;
      else samples.set(key, { hour, metric, path, bucket, count: 1 });
    }

    // The only write for `sigil_vitals` — no repository write behind it at
    // all anymore. See `absorbViews`'s comment on why a throw here is left to
    // propagate rather than caught.
    await this.datasets.vitals.recordMany(
      [...samples.values()].map((sample) => ({
        sigilId: sigil.id,
        metric: sample.metric,
        path: sample.path,
        bucket: sample.bucket,
        samples: sample.count,
        hour: sample.hour,
      })),
    );
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
   * When an event happened, for bucketing — the client's claim if it is
   * credible, else when this batch arrived.
   *
   * Absorb time was the only answer until the envelope carried `ts`, and it is
   * wrong by however long the batch waited: five seconds in the browser queue,
   * up to ten more in the app's sink provider, plus whatever a retry added. An
   * event a few seconds before the hour therefore landed in the next bucket,
   * which defeats the reason the buckets are hourly — reading a 14:00 deploy
   * against 13:00.
   *
   * **The value is client-supplied, so it is clamped rather than trusted.**
   * Whoever holds the sigil token can claim any time at all; unclamped, that
   * turns "can inflate today's count" — already true, and documented on
   * `sigil_views_hourly` — into "can rewrite last month's chart", which is a
   * different and worse property. Outside the window the timestamp is
   * discarded, not rejected: a batch is not worth refusing over a bad clock,
   * and absorb time is exactly as good as what came before.
   *
   * Six hours back covers any plausible retry or queue stall; five minutes
   * forward covers ordinary client clock skew without opening the future.
   */
  protected eventTime(ts: number | undefined, now: string): string {
    if (ts === undefined) return now;

    const MAX_PAST_MS = 6 * 60 * 60 * 1000;
    const MAX_FUTURE_MS = 5 * 60 * 1000;
    const nowMs = Date.parse(now);
    if (Number.isNaN(nowMs)) return now;
    if (ts > nowMs + MAX_FUTURE_MS || ts < nowMs - MAX_PAST_MS) return now;

    return new Date(ts).toISOString();
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

/**
 * One accepted error, with every same-fingerprint sibling in its envelope
 * already summed into `count`.
 *
 * Produced by {@link SigilIngestService.foldByFingerprint} and written to both
 * `sigil_error_groups` and `blights`, which is why it carries the union of what
 * the two tables need under neutral names — `stack` becomes `stackSample` on
 * one of them.
 */
interface FoldedError {
  fingerprint: string;
  name: string;
  message: string;
  stack: string;
  sourceUrl: string;
  origin: "client" | "server";
  count: number;
}
