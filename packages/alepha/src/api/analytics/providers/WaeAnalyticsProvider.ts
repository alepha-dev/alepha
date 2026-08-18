import { $env, $hook, $inject, Alepha, AlephaError, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { AnalyticsBuckets } from "../planner/AnalyticsBuckets.ts";
import { AnalyticsSlotMap } from "../planner/AnalyticsSlotMap.ts";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";
import type {
  AnalyticsAggregate,
  AnalyticsQuery,
  AnalyticsResult,
} from "../schemas/analyticsQuerySchema.ts";
import { AnalyticsEngineSql } from "../services/AnalyticsEngineSql.ts";
import { AnalyticsProvider, type AnalyticsRow } from "./AnalyticsProvider.ts";
import { OrmAnalyticsProvider } from "./OrmAnalyticsProvider.ts";

/**
 * The write half of a Workers Analytics Engine dataset binding.
 *
 * Declared here rather than imported from `@cloudflare/workers-types` so this
 * module compiles and tests anywhere — the whole surface is one method, and
 * depending on the Workers type package to describe it would make a provider
 * that needs no workerd API only buildable under workerd.
 */
export interface AnalyticsEngineDataset {
  writeDataPoint(point: {
    indexes?: string[];
    blobs?: Array<string | null>;
    doubles?: number[];
  }): void;
}

/**
 * `CLOUDFLARE_ANALYTICS_DATASET` does double duty, mirroring
 * `R2FileStorageProvider`'s `R2_BUCKET_NAME`: it is both the property key
 * this provider looks up on `cloudflareEnv` for the write binding, and the
 * table name spliced into `FROM` for reads — i.e. `alepha build` is expected
 * to emit a `wrangler.toml` entry whose `binding` and `dataset` are the same
 * string. All three variables are `.optional()` so the provider can be
 * registered (and constructed) in non-Workers contexts — Node `yarn start`,
 * build-time introspection, under `alepha.isTest()` where it is never
 * selected — without forcing every dev to set them.
 */
const envSchema = z.object({
  CLOUDFLARE_ANALYTICS_DATASET: z
    .text({
      secret: false,
      description:
        "Analytics Engine dataset name — used both as the wrangler.toml binding key (env.<name>) for writes and as the SQL FROM table for reads. Unset means this provider is never selected; see index.workerd.ts.",
    })
    .optional(),
  CLOUDFLARE_ACCOUNT_ID: z
    .text({
      description:
        "Cloudflare account id, for the Analytics Engine SQL read API (there is no read binding — see AnalyticsEngineSql).",
    })
    .optional(),
  // Deliberately NOT named CLOUDFLARE_API_TOKEN: wrangler treats that name as
  // its own credential, so setting it in .env.<env> makes `wrangler auth token`
  // return this read-only token and every provisioning call fails with an
  // authentication error.
  CLOUDFLARE_ANALYTICS_TOKEN: z
    .text({
      description:
        "API token scoped to Account Analytics Read, for the Analytics Engine SQL read API. Never a deploy credential.",
    })
    .optional(),
});

/**
 * Hot rows on Workers Analytics Engine, rolled rows in a durable store.
 *
 * A DI-injectable provider, not a plain constructor-options class — this is
 * the second design of this class. The first took `dataset` / `sql` / `cold`
 * as constructor options, which made it easy to unit test but impossible for
 * `index.workerd.ts` to select automatically: `alepha.with({ provide, use })`
 * constructs `use` via `alepha.inject(use)`, which needs a class DI can build
 * on its own. Follows `CloudflareEmailProvider` closely — the closest
 * existing analogue, combining a **write-only Workers binding** with an
 * **account-scoped REST API** gated by `CLOUDFLARE_ACCOUNT_ID` /
 * `CLOUDFLARE_ANALYTICS_TOKEN`:
 *
 * - `$inject(Alepha)` + `$hook({ on: "start" })` reads
 *   `this.alepha.get("cloudflare.env")` and stores the binding in a
 *   `protected` field, exactly like `R2FileStorageProvider` and
 *   `CloudflareEmailProvider`.
 * - `cold = $inject(OrmAnalyticsProvider)` is the **concrete** class, not
 *   `$inject(AnalyticsProvider)`. Injecting the abstract seam here would be
 *   circular the moment `index.workerd.ts`'s `register()` substitutes this
 *   very class in for that seam — this provider would try to inject itself.
 * - `AnalyticsEngineSql` is still a plain constructor-options class (nothing
 *   about it needs DI), just built internally by {@link sql} rather than
 *   passed in — the same relationship `CloudflareEmailProvider.sendViaRest`
 *   has with `fetch`.
 *
 * Testability does not regress: `alepha.set("cloudflare.env", { NAME: fake })`
 * before `start()` substitutes the write binding, the same pattern
 * `CloudflareEmailProvider.spec.ts` uses; a test subclass overriding
 * {@link httpFetch} substitutes the read transport, the same pattern
 * `CloudflareEmailRest.spec.ts` uses for `httpPost`.
 *
 * ## Every number read back is an estimate
 *
 * Analytics Engine samples, and `_sample_interval` — how many real events each
 * stored row stands for — varies per row, so a constant multiplier is wrong.
 * Every measure comes back as `sum(double * _sample_interval)` — the
 * sample-interval-corrected sum, never a raw stored double — and the result
 * carries `estimated: true` so a UI cannot present them as measurements by
 * accident.
 *
 * ## The cold tier cannot be Analytics Engine
 *
 * Writing aggregates back as new data points would give them a fresh retention
 * clock, re-sample already-sampled data, and require a discriminator to keep
 * rolled rows from being counted alongside the raw ones they summarise. So a
 * Cloudflare deployment needs a relational store for anything older than the
 * hot window — the same compromise unique visitors already forced on
 * `WaeAnalyticsStore` in `@alepha/sigil`.
 *
 * `record()` never writes to `cold` — only to Analytics Engine — so `cold`'s
 * raw tier starts every dataset's life with zero rows for it. Left alone,
 * `cold.rollup()` would fold a table nothing ever populated: a structural
 * no-op, not a race, and it would silently lose every hour past Analytics
 * Engine's own ~90-day retention, which is exactly what a hot/cold split
 * exists to prevent. {@link rollup} closes that gap itself, immediately
 * before delegating: it tops up `cold`'s raw tier with Analytics Engine rows
 * older than `before` (hour granularity, matching what `record()` would have
 * written directly), *then* calls `cold.rollup()` to fold them — see
 * {@link forwardToCold}. What crosses over is the sample-corrected total
 * `query()` already computed, not a raw stored double, so `cold`'s own
 * arithmetic (the upsert accumulate, the day fold) can add and fold it
 * exactly like any other number, the same one-way trip every folded number
 * already takes when `OrmAnalyticsProvider` moves a row from its own raw
 * tier to its own rolled tier. That is a statement about arithmetic, not
 * about epistemics, and the two must not be conflated: the number is safe to
 * add without re-applying a correction, but it is still, irreducibly, a
 * number that came from a sample. See "The read side has to merge too"
 * below for why `estimated` stays `true` regardless of which tier answered a
 * query.
 *
 * ## `prune()` cannot rely on deletion alone
 *
 * Analytics Engine has no delete API, so `cold.prune(dataset, before)` alone
 * cannot make Analytics Engine's own copy of `[..., before)` stop existing —
 * it only removes `cold`'s copy. Left at that, `AnalyticsProvider.prune`'s
 * own contract ("deletes every row older than `before`, **on whichever tier
 * it lives**") would be silently broken on this backend: a query for an
 * already-pruned window would fall out of `cold` and fall back to Analytics
 * Engine, which still has it and always will until its own ~90-day
 * retention eventually, invisibly, ages it out. {@link prune} therefore also
 * durably records `before` as a prune floor — via
 * `OrmAnalyticsProvider.recordPruneFloor`, kept in `cold` because it is the
 * one piece of this provider's state that already survives a restart — and
 * {@link query}/{@link forwardToCold} both clamp their effective `since` to
 * it, on every read, regardless of what either tier currently holds. That is
 * what makes `prune()` mean the same thing here as it does on
 * `OrmAnalyticsProvider`: once pruned, gone from every result, not merely
 * from `cold`'s own copy. See `recordPruneFloor`'s own doc for why this is a
 * dedicated table rather than a row in the dataset's own raw/rolled table,
 * and {@link prune}'s own doc for why the floor is written *before* the
 * delete, not after.
 *
 * ## The read side has to merge too
 *
 * Forwarding rows into `cold` is pointless if `query()` never reads them
 * back — a window older than Analytics Engine's retention would still
 * silently return nothing, and the worst case is a window straddling the
 * boundary returning only the Analytics Engine portion with no sign anything
 * is missing. So {@link query} queries both sources and merges, the same way
 * `OrmAnalyticsProvider.query()` already merges its own raw and rolled
 * tiers — same merge key (`JSON.stringify` of the grouped dimension values),
 * the same mergeable aggregate (`sum`, added across sources), ordering and
 * `limit` applied once to the merged set rather than per source. Two things
 * are specific to a *composite* of two different backends rather than two
 * tables in the same one:
 *
 * - **Skipping `cold` when it cannot matter.** A window entirely within
 *   `dataset`'s declared hot retention cannot have anything forwarded into
 *   it yet in a correctly-running system — see {@link mightNeedCold} — so
 *   `query()` skips `cold` for that case with zero calls to it, the same
 *   structural argument that makes {@link forwardToCold} safe rather than a
 *   speed hack.
 * - **Not double-counting an hour Analytics Engine still has after it was
 *   forwarded.** Analytics Engine has no delete API, so a forwarded hour
 *   keeps existing on both sides forever. `query()` re-derives the same
 *   watermark {@link forwardToCold} uses and narrows the Analytics Engine
 *   side's `since` to exclude whatever `cold` already covers — see
 *   {@link nextBucket} — rather than trusting the two sources to be disjoint.
 * - **`estimated` is unconditionally `true`.** Not just because Analytics
 *   Engine samples, but because a row `cold` holds only ever got there
 *   through `forwardToCold`, which itself read it out of Analytics Engine as
 *   a sample-corrected estimate. Landing in a relational table does not
 *   retroactively make it a measurement — so a merge where every
 *   contributing row came from `cold` is *not* exact either, and does not
 *   report `estimated: false`. Nothing this provider can return was ever
 *   measured directly; only `OrmAnalyticsProvider` running on its own
 *   (never forwarded through Analytics Engine at all) earns that.
 *
 * ## Writes are free of round-trips
 *
 * `writeDataPoint()` returns nothing and is not awaited; the runtime writes in
 * the background. The sequential round-trip cost that dominates a remote
 * database disappears on this path entirely.
 */
export class WaeAnalyticsProvider extends AnalyticsProvider {
  /**
   * The Workers env key the write binding is exposed under.
   *
   * A wrangler `analytics_engine_datasets` entry has two independent fields:
   * `binding` is the property name on `env`, `dataset` is the table the SQL
   * API reads. `alepha build` emits a fixed `binding` of `ANALYTICS` and a
   * derived `dataset` (the deployment prefix), so the two are **not** the same
   * string and this must not be looked up by dataset name.
   *
   * That mistake is worse than a miss, and it cost a production 500. Datasets
   * and R2 buckets are both named from the same prefix, so
   * `env["lore-production"]` resolved to the **R2 bucket** — truthy, past the
   * not-found guard, and straight into `n.writeDataPoint is not a function`.
   *
   * Must stay in sync with `BuildCloudflareTask.ANALYTICS_ENGINE_BINDING`.
   * Duplicated rather than imported: this package must not depend on the CLI.
   */
  public static readonly BINDING = "ANALYTICS";

  /**
   * Analytics Engine keeps roughly three months.
   */
  public static readonly MAX_HOT_DAYS = 90;

  /**
   * A `since` boundary older than any real bucket, for the one query in this
   * class that means "from the beginning" — {@link forwardToCold}'s first
   * sweep, before `cold` has a watermark of its own.
   */
  protected static readonly EPOCH_DAY = "1970-01-01";

  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(envSchema);
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The durable store for `rollup`/`prune`/`query`. The concrete class — see
   * the class doc for why the abstract `AnalyticsProvider` seam would be
   * circular here.
   */
  protected readonly cold = $inject(OrmAnalyticsProvider);

  protected binding?: AnalyticsEngineDataset;
  protected sqlClient?: AnalyticsEngineSql;

  /**
   * Tolerates booting off-Workers, the same as `CloudflareEmailProvider`'s
   * `onStart`: the provider has to be constructible (and startable) under
   * Node — `yarn start`, build-time introspection — without a binding
   * present, so this warns rather than throws. `record()`/`query()` throw
   * their own clear errors if actually called with no binding wired.
   */
  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      const cloudflareEnv = this.alepha.get("cloudflare.env") as
        | Record<string, unknown>
        | undefined;
      if (!cloudflareEnv) {
        this.log.warn(
          "Analytics Engine inert: 'cloudflare.env' not set (not running on Workers).",
        );
        return;
      }

      const name = this.env.CLOUDFLARE_ANALYTICS_DATASET;
      if (!name) {
        this.log.warn(
          "Analytics Engine inert: CLOUDFLARE_ANALYTICS_DATASET is not set.",
        );
        return;
      }

      const binding = cloudflareEnv[WaeAnalyticsProvider.BINDING] as
        | AnalyticsEngineDataset
        | undefined;
      if (!binding) {
        this.log.warn(
          `Analytics Engine inert: binding '${WaeAnalyticsProvider.BINDING}' not found in Workers environment.`,
        );
        return;
      }

      this.binding = binding;
      this.log.info(`Analytics Engine ready (dataset: ${name})`);
    },
  });

  /**
   * The hot tier has nothing to declare — Analytics Engine has no schema to
   * create ahead of time, the same as `MemoryAnalyticsProvider`. Three
   * things still have to happen here rather than at first write:
   *
   * - `retention.hot` is checked now, via {@link assertRetention}. Analytics
   *   Engine silently discards data past ~90 days regardless of what a
   *   dataset declares, so a longer window has to fail loud at declaration
   *   time, not once a report quietly comes up short months later.
   * - `cold` is registered, so its own tables exist before `alepha.start()`
   *   — the same eager-registration rule `OrmAnalyticsProvider` follows.
   *   That call brings the shared prune-floor table with it, which this
   *   provider is the only one to actually read (Analytics Engine has no
   *   delete API — see {@link prune}). It used to be requested from here
   *   instead, so that a relational deployment would not carry it; that made
   *   the schema depend on the runtime, and the table was consequently
   *   missing from every migration ever generated. See
   *   `OrmAnalyticsProvider.registerPruneFloors()`.
   */
  public register(dataset: AnalyticsDataset): void {
    this.assertRetention(dataset);
    this.cold.register(dataset);
  }

  /**
   * Refuses a dataset whose declared hot window outlives what Analytics
   * Engine actually keeps.
   *
   * Public (not just called from {@link register}) so a caller building a
   * dataset descriptor by hand can validate it before wiring anything up.
   */
  public assertRetention(dataset: AnalyticsDataset): void {
    const hot = dataset.retention?.hot;
    if (!hot) return;
    const days = AnalyticsBuckets.parseWindow(hot) / (24 * 60 * 60 * 1000);
    if (days > WaeAnalyticsProvider.MAX_HOT_DAYS) {
      throw new AlephaError(
        `Dataset '${dataset.name}' asks for a ${days}-day hot window, but Analytics Engine keeps roughly 90 days. Shorten 'retention.hot' or the window will silently be shorter than declared.`,
      );
    }
  }

  public async record(
    dataset: AnalyticsDataset,
    rows: AnalyticsRow[],
  ): Promise<void> {
    const binding = this.requireBinding();
    const map = AnalyticsSlotMap.forDataset(dataset);

    for (const row of rows) {
      const blobs: Array<string | null> = [];
      blobs[AnalyticsSlotMap.KIND_SLOT - 1] = dataset.name;
      blobs[AnalyticsSlotMap.HOUR_SLOT - 1] = row.hour;
      for (const name of map.dimensionNames) {
        blobs[map.blobSlot(name) - 1] = String(row[name] ?? "");
      }

      const doubles: number[] = [];
      for (const name of map.measureNames) {
        doubles[map.doubleSlot(name) - 1] = Number(row[name] ?? 0);
      }

      binding.writeDataPoint({
        indexes: [String(row[dataset.index] ?? "")],
        blobs: blobs.map((value) => value ?? null),
        doubles: doubles.map((value) => value ?? 0),
      });
    }
  }

  /**
   * Queries Analytics Engine and `cold` and merges the two — see the class
   * doc's "The read side has to merge too" section for why both the skip and
   * the watermark exclusion are necessary, not optional polish.
   *
   * Clamped first to `dataset`'s prune floor (see {@link prune}): Analytics
   * Engine has no delete API, so a window `prune()` was already asked to
   * remove could otherwise still be answered from Analytics Engine even
   * after `cold` has genuinely forgotten it. Raising the effective `since`
   * to the floor — before either leg runs, never after — is what makes
   * `prune()` mean the same thing here as it does on `OrmAnalyticsProvider`:
   * once pruned, gone from every read, not just from `cold`'s own copy.
   */
  public async query(
    dataset: AnalyticsDataset,
    query: AnalyticsQuery,
  ): Promise<AnalyticsResult> {
    const floor = await this.cold.pruneFloor(dataset);
    const since = floor ? this.laterBound(query.since, floor) : query.since;

    if (!this.mightNeedCold(dataset, since)) {
      return this.queryHot(dataset, { ...query, since });
    }

    const watermark = await this.coldWatermark(dataset);

    // `orderBy`/`limit` are deliberately left out of what each source
    // receives. `mergeResults` is the only place they may be applied — once,
    // to the merged set — because applying a `limit` to each source
    // separately can drop a row that only belongs in the true top-N once
    // both sources are combined (see the class doc).
    const unordered: AnalyticsQuery = {
      since,
      where: query.where,
      groupBy: query.groupBy,
      select: query.select,
    };
    const hotSince = watermark
      ? this.laterBound(since, this.nextBucket(watermark))
      : since;

    const [hot, cold] = await Promise.all([
      this.queryHot(dataset, { ...unordered, since: hotSince }),
      this.cold.query(dataset, unordered),
    ]);

    return this.mergeResults(query, hot, cold);
  }

  /**
   * Whether a query starting at `since` could possibly need `cold` at all,
   * decided from `dataset`'s own declared retention rather than `cold`'s
   * actual state — computable with zero calls to `cold`, which is what lets
   * {@link query} skip it entirely for a window that is clearly still within
   * Analytics Engine's live range.
   *
   * Safe even when wrong in the "check anyway" direction (harmless, just a
   * wasted round trip) and provably safe in the "skip" direction too: a
   * correctly-running {@link forwardToCold} never forwards a row newer than
   * `dataset`'s declared hot floor, and Analytics Engine never deletes
   * anything on its own — so if the whole window is at or after that floor,
   * every row it could contain is still in Analytics Engine regardless of
   * whether `cold` also happens to have a copy.
   *
   * Conservative when retention is undeclared: with no declared hot window,
   * Cloudflare's own ~90-day platform limit is the only bound this class
   * knows, and it is not narrow enough to skip `cold` safely — so this
   * returns `true` (always check) rather than guess.
   */
  protected mightNeedCold(dataset: AnalyticsDataset, since: string): boolean {
    const hot = dataset.retention?.hot;
    if (!hot) return true;
    const days = AnalyticsBuckets.parseWindow(hot) / (24 * 60 * 60 * 1000);
    const today = AnalyticsBuckets.day(
      AnalyticsBuckets.hour(this.dateTime.nowMillis()),
    );
    const hotFloor = AnalyticsBuckets.shiftDays(today, -days);
    return since < hotFloor;
  }

  /**
   * The Analytics Engine half of `query()` — everything this class did
   * before it had a `cold` to merge with, unchanged. {@link forwardToCold}
   * also calls this directly (never the public `query()`) specifically to
   * avoid the merge: forwarding needs Analytics Engine's own rows, not an
   * already-merged view that would include rows `cold` itself contributed.
   */
  protected async queryHot(
    dataset: AnalyticsDataset,
    query: AnalyticsQuery,
  ): Promise<AnalyticsResult> {
    const map = AnalyticsSlotMap.forDataset(dataset);
    const conditions = [
      `blob${AnalyticsSlotMap.KIND_SLOT} = ${AnalyticsEngineSql.quote(dataset.name)}`,
      `blob${AnalyticsSlotMap.HOUR_SLOT} >= ${AnalyticsEngineSql.quote(query.since)}`,
    ];

    for (const [name, filter] of Object.entries(query.where ?? {})) {
      // `map.blobSlot` throws `AlephaError` for a name that is not one of
      // `dataset`'s declared dimensions — the same guard
      // `OrmAnalyticsProvider` gives an explicit name to
      // (`assertKnownDimension`). `query.where`'s keys are far more likely to
      // carry client-supplied input than `dataset` itself, and this call has
      // to run before the name is spliced into SQL text as a raw column
      // reference, not after.
      const slot = `blob${map.blobSlot(name)}`;

      if (
        typeof filter === "object" &&
        filter !== null &&
        "inArray" in filter
      ) {
        // An empty list means "match nothing". Emitting `IN ()` would be a
        // syntax error, and omitting the clause would silently widen the
        // query to every row — the failure that matters.
        if (filter.inArray.length === 0) {
          return { rows: [], estimated: true };
        }
        conditions.push(
          // Every dimension, whatever its declared type, is stored as a
          // String blob (`record()` always writes `String(row[name])`) — so
          // a numeric dimension's filter value has to be quoted as the
          // string Analytics Engine actually stores, not left as a bare
          // numeric literal. `String(...)` first, unconditionally: a blob
          // column compared against an unquoted number does not match, since
          // the column itself was never numeric to begin with.
          `${slot} IN (${AnalyticsEngineSql.quoteList(filter.inArray.map(String))})`,
        );
      } else {
        conditions.push(
          `${slot} = ${AnalyticsEngineSql.quote(String(filter))}`,
        );
      }
    }

    const groupBy = query.groupBy ?? [];
    const projections: string[] = [];
    const grouping: string[] = [];
    for (const name of groupBy) {
      const expression =
        name === "day"
          ? `substring(blob${AnalyticsSlotMap.HOUR_SLOT}, 1, 10)`
          : name === "hour"
            ? `blob${AnalyticsSlotMap.HOUR_SLOT}`
            : `blob${map.blobSlot(name)}`;
      projections.push(`${expression} AS ${name}`);
      // ⚠️ The ALIAS, not the expression — `GROUP BY substring(blob2, 1, 10)`
      // is a 422 here ("in the GROUP BY clause you may only provide column
      // names"), while every relational backend accepts it. Only the `day`
      // pseudo-dimension is affected in practice, since it is the one
      // grouping key that is not already a bare `blobN`, but grouping by the
      // alias is correct for all of them and keeps the two clauses from
      // drifting apart.
      //
      // No new injection surface: `name` is either the `day`/`hour` literal
      // or a dimension `map.blobSlot(name)` has already accepted, and it is
      // spliced into the projection as `AS ${name}` on the line above
      // regardless.
      grouping.push(name);
    }

    for (const [measure, aggregate] of Object.entries(query.select)) {
      // Same guard as above, against `query.select`'s keys — thrown by
      // `map.doubleSlot` for a measure the dataset never declared.
      const slot = `double${map.doubleSlot(measure)}`;
      projections.push(
        `${this.aggregateExpression(aggregate, slot)} AS ${measure}`,
      );
    }

    projections.push("max(_sample_interval) AS _si");

    // ⚠️ `count()`, with NO arguments — not `COUNT(*)`, which is what every
    // relational sibling of this provider writes and what this line said
    // until it took production down on 2026-08-11:
    //
    //   HAVING COUNT(*) > 0 → 422 "COUNT() function must have 0 arguments: 1"
    //   HAVING count()  > 0 → 200
    //
    // `OrmAnalyticsProvider` keeps `COUNT(*)`, which is correct there and
    // invalid here — the two clauses look like a copy-paste divergence and
    // are not. The clause itself earns its place on both: with no `GROUP BY`,
    // an aggregate over zero rows still returns one all-NULL row, and this is
    // what suppresses it.

    const rows = await this.sql().query(`
      SELECT ${projections.join(", ")}
      FROM ${AnalyticsEngineSql.quoteIdentifier(this.requireDatasetName())}
      WHERE ${conditions.join(" AND ")}
      ${grouping.length ? `GROUP BY ${grouping.join(", ")}` : ""}
      HAVING count() > 0
    `);

    let sampleInterval = 1;
    const out: Array<Record<string, string | number>> = rows.map((row) => {
      sampleInterval = Math.max(
        sampleInterval,
        AnalyticsEngineSql.num(row, "_si"),
      );
      const record: Record<string, string | number> = {};
      for (const name of groupBy) {
        // `day`/`hour` are always strings. Every other declared dimension is
        // stored as a String blob regardless of its own declared type
        // (`record()` always writes `String(row[name])`), so reading it back
        // has to decode through `dataset`'s own declared type rather than
        // blanket-stringing it. A numeric dimension (a histogram bucket
        // index, say) otherwise comes back as `"3"` instead of `3`, which
        // throws downstream in `cold.record()` (validated against the same
        // declared type) and splits one group into two in `mergeResults`'s
        // `JSON.stringify`-keyed merge with `cold` — `cold` decodes the
        // identical dimension through its own typed column and
        // never stringifies it.
        const isDayOrHour = name === "day" || name === "hour";
        const isNumeric =
          !isDayOrHour && z.schema.isNumber(dataset.dimensions.shape[name]);
        record[name] = isNumeric
          ? AnalyticsEngineSql.num(row, name)
          : AnalyticsEngineSql.str(row, name);
      }
      for (const measure of Object.keys(query.select)) {
        record[measure] = AnalyticsEngineSql.num(row, measure);
      }
      return record;
    });

    // Sorted and limited client-side, never in the SQL text. `orderBy.key` is
    // caller-supplied — most plausibly an HTTP endpoint's query params — and
    // splicing it into an `ORDER BY` clause would let it name an arbitrary
    // expression rather than one of the columns this query actually
    // projected. Every sibling provider already sorts here, for the same
    // reason its own cross-tier merge has to happen in JS.
    if (query.orderBy) {
      const { key, direction } = query.orderBy;
      out.sort((a, b) => {
        const left = a[key];
        const right = b[key];
        const comparison =
          typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left).localeCompare(String(right));
        return direction === "desc" ? -comparison : comparison;
      });
    }

    const limited = query.limit !== undefined ? out.slice(0, query.limit) : out;

    return { rows: limited, estimated: true, sampleInterval };
  }

  /**
   * Tops up `cold`'s raw tier with Analytics Engine rows older than `before`
   * (see {@link forwardToCold}), then folds `cold` exactly as
   * `OrmAnalyticsProvider.rollup()` always has. See the class doc for why
   * the top-up has to happen here at all.
   */
  public async rollup(
    dataset: AnalyticsDataset,
    before: string,
  ): Promise<void> {
    await this.forwardToCold(dataset, before);
    await this.cold.rollup(dataset, before);
  }

  /**
   * Records `before` as the prune floor, **then** deletes from `cold` —
   * order matters. Analytics Engine has no delete API, so `cold.prune()`
   * alone cannot make the data stop existing; it only stops being *this
   * provider's* copy of it. `query()`/`forwardToCold()` are what actually
   * honour `prune()`'s contract on this backend, by clamping every read to
   * {@link OrmAnalyticsProvider.pruneFloor}, so the floor has to be durable
   * and visible to them before anything is deleted.
   *
   * The floor-first ordering is deliberate, not incidental: if this crashes
   * between the two steps, the floor is already recorded, so a query
   * immediately after under-reports (some rows `cold.prune()` never actually
   * got to delete are simply not served, even though they still exist) —
   * never over-reports. The reverse order would mean a crash after deleting
   * but before recording the floor leaves `query()` free to resurrect the
   * just-deleted range from Analytics Engine, which is exactly the bug this
   * whole mechanism exists to close. Either way self-heals on the next
   * sweep; only the direction of the transient error differs, and
   * under-reporting briefly is the safe one.
   */
  public async prune(dataset: AnalyticsDataset, before: string): Promise<void> {
    await this.cold.recordPruneFloor(dataset, before);
    await this.cold.prune(dataset, before);
  }

  /**
   * Writes Analytics Engine rows older than `before` into `cold`'s raw tier,
   * so the `cold.rollup()` call right after this one has something to fold.
   *
   * Grouped by **hour** (plus every declared dimension) — not day.
   * `OrmAnalyticsProvider` already owns the hour→day boundary inside its own
   * `rollup()`, immediately following; routing around it by pre-folding to
   * day here would duplicate that logic for no reason.
   *
   * ## Idempotency
   *
   * This runs on a schedule and Analytics Engine keeps every row it has ever
   * received (there is no delete API), so a naive "forward everything before
   * `before`" on every sweep would re-add the same corrected totals on top of
   * themselves via `cold.record()`'s accumulate-upsert. Instead, a watermark
   * is derived from `cold`'s own state — no new schema, no new API on
   * `OrmAnalyticsProvider` — via {@link coldWatermark}, and only rows after
   * it are forwarded.
   *
   * This is also what makes the sequence safe across a crash between this
   * method and the `cold.rollup()` call that follows it: a row that landed in
   * `cold`'s raw tier but was never folded still moves the watermark (it is
   * still the newest row `cold` holds), so the next sweep will not forward it
   * again — it will just re-run `cold.rollup()`, which is already idempotent.
   *
   * ## Never re-imports what `prune()` already removed
   *
   * `prune()`'s effect on `cold` (a real `DELETE`) is easy to undo by
   * accident here: without a check, the very next sweep would re-query
   * Analytics Engine for that same range (it never forgot it — no delete
   * API) and forward it right back into `cold`, quietly resurrecting data a
   * caller already asked to prune. {@link OrmAnalyticsProvider.pruneFloor}
   * is consulted the same way the watermark is — both narrow `since` and
   * both filter `result.rows` — so a pruned range is excluded going in
   * (cheaper) and would still be excluded even if it were not (correct).
   */
  protected async forwardToCold(
    dataset: AnalyticsDataset,
    before: string,
  ): Promise<void> {
    const [watermark, floor] = await Promise.all([
      this.coldWatermark(dataset),
      this.cold.pruneFloor(dataset),
    ]);
    const watermarkSince = watermark
      ? AnalyticsBuckets.day(watermark)
      : WaeAnalyticsProvider.EPOCH_DAY;
    const since = floor
      ? this.laterBound(watermarkSince, floor)
      : watermarkSince;

    const dimensions = Object.keys(dataset.dimensions.shape).sort();
    const measures = Object.keys(dataset.measures.shape);
    const select: Record<string, AnalyticsAggregate> = {};
    for (const measure of measures) select[measure] = "sum";

    // `queryHot`, not `query()`: the sample-interval correction
    // (`aggregateExpression`) and the dimension/measure name validation both
    // live there, and forwarded rows have to carry the same corrected totals
    // a caller querying Analytics Engine directly would see, not a raw
    // stored double — but this must stay scoped to Analytics Engine's own
    // rows. Calling the public `query()` here would merge in `cold`'s rows
    // too, which is exactly what must NOT be forwarded back into `cold`.
    const result = await this.queryHot(dataset, {
      since,
      groupBy: ["hour", ...dimensions],
      select,
    });

    const boundary = AnalyticsBuckets.day(before);
    const rows: AnalyticsRow[] = [];
    for (const row of result.rows) {
      const hour = String(row.hour);
      if (watermark && this.isForwarded(hour, watermark)) continue;
      if (floor && AnalyticsBuckets.day(hour) < floor) continue;
      if (AnalyticsBuckets.day(hour) >= boundary) continue;

      const forwarded: Record<string, string | number> & { hour: string } = {
        hour,
      };
      for (const name of dimensions) forwarded[name] = row[name];
      for (const measure of measures) {
        forwarded[measure] = Number(row[measure] ?? 0);
      }
      rows.push(forwarded);
    }

    if (rows.length === 0) return;
    await this.cold.record(dataset, rows);
  }

  /**
   * The newest bucket `cold` already holds for `dataset`, across both its
   * raw and rolled tiers — `OrmAnalyticsProvider.query()` merges them, so
   * this sees a row whichever tier it currently lives in. `undefined` means
   * `cold` has nothing yet for this dataset, i.e. forward from the beginning.
   *
   * The `select` measure is arbitrary — any declared one — and the
   * aggregate is `"sum"` only because `AnalyticsQuery.select` cannot be
   * empty; the value itself is discarded. Only `row.hour` (really
   * whichever bucket is newest, day- or hour-precision — see
   * {@link isForwarded}) is used.
   */
  protected async coldWatermark(
    dataset: AnalyticsDataset,
  ): Promise<string | undefined> {
    const measure = Object.keys(dataset.measures.shape)[0];
    if (!measure) return undefined;

    const result = await this.cold.query(dataset, {
      since: WaeAnalyticsProvider.EPOCH_DAY,
      groupBy: ["hour"],
      select: { [measure]: "sum" },
      orderBy: { key: "hour", direction: "desc" },
      limit: 1,
    });

    const newest = result.rows[0]?.hour;
    return newest === undefined ? undefined : String(newest);
  }

  /**
   * Whether an Analytics Engine `hour` bucket is already covered by
   * `watermark`.
   *
   * `watermark` comes from {@link coldWatermark}, which reads the same
   * `time_bucket` column `OrmAnalyticsProvider` uses for both of its tiers —
   * so its precision tells you which tier it came from. A **day**-precision
   * watermark (`YYYY-MM-DD`) can only have come from an already-rolled row,
   * which folds a whole day atomically, so it covers every hour of that day.
   * An **hour**-precision watermark (`YYYY-MM-DDTHH`) means a row survived a
   * crash between {@link forwardToCold}'s write and the `cold.rollup()` fold
   * that was supposed to follow it — still in the raw tier, still exactly
   * one bucket, so a plain string comparison against another hour-precision
   * value is correct as-is.
   *
   * Comparing a day-precision watermark to an hour string with a plain `<=`
   * would be wrong: `"2026-08-01T14" <= "2026-08-01"` is `false` (the longer
   * string sorts after any prefix of itself), which would forward every hour
   * of an already-fully-rolled day right back into `cold` on the next sweep.
   */
  protected isForwarded(hour: string, watermark: string): boolean {
    // `YYYY-MM-DD` is 10 characters; `YYYY-MM-DDTHH` is 13. Nothing shorter
    // or in between is a bucket `coldWatermark` can produce.
    const isDayPrecision = watermark.length === 10;
    if (isDayPrecision) {
      return AnalyticsBuckets.day(hour) <= watermark;
    }
    return hour <= watermark;
  }

  /**
   * The smallest bucket string strictly after `watermark`, safe to use as a
   * `since` lower bound: excludes exactly what {@link isForwarded} already
   * treats as covered, and nothing more.
   *
   * Day-precision in, day-precision out — `AnalyticsBuckets.shiftDays`
   * already does that arithmetic. Hour-precision needs real millisecond
   * arithmetic, since `AnalyticsBuckets` has no `nextHour`: this is `query()`
   * narrowing the Analytics Engine side away from an hour `cold` picked up
   * mid-crash (see {@link isForwarded}'s hour-precision case) — a real but
   * rare path, not the everyday one.
   */
  protected nextBucket(watermark: string): string {
    if (watermark.length === 10) {
      return AnalyticsBuckets.shiftDays(watermark, 1);
    }
    const millis = Date.parse(`${watermark}:00:00.000Z`);
    return new Date(millis + 60 * 60 * 1000).toISOString().slice(0, 13);
  }

  /**
   * The chronologically later of two bucket-prefixed strings, comparable
   * directly even when one is day-precision and the other hour-precision —
   * the same property `isForwarded`/`nextBucket` already rely on: a bare day
   * is a prefix of every hour within it, and a prefix sorts before anything
   * it is a prefix of.
   */
  protected laterBound(a: string, b: string): string {
    return a > b ? a : b;
  }

  /**
   * Merges Analytics Engine's and `cold`'s results the same way
   * `OrmAnalyticsProvider.query()` merges its own raw and rolled tiers: one
   * `JSON.stringify`-keyed pass to combine matching groups (never a
   * delimiter join — an unsanitised dimension value could collide), ordering
   * and `limit` applied exactly once, to the merged set, never per source
   * (a per-source `limit` would drop rows that belong in the true top-N).
   *
   * `estimated` is unconditionally `true` — see the class doc's "The read
   * side has to merge too" section for why every row this provider can ever
   * return, `cold`'s included, traces back to a sample. `sampleInterval`
   * still follows `hot` alone: `cold` never stores what interval a forwarded
   * row was corrected with, so the only sample-interval `mergeResults` can
   * ever report is the one `hot` itself just measured — `undefined` when
   * `hot` contributed nothing to this merge, which is honest (unknown)
   * rather than the false confidence of an assumed `1`.
   */
  protected mergeResults(
    query: AnalyticsQuery,
    hot: AnalyticsResult,
    cold: AnalyticsResult,
  ): AnalyticsResult {
    const groupBy = query.groupBy ?? [];
    const merged = new Map<string, Record<string, string | number>>();

    for (const result of [hot, cold]) {
      for (const row of result.rows) {
        const key = JSON.stringify(groupBy.map((name) => row[name]));
        const existing = merged.get(key);
        if (!existing) {
          merged.set(key, { ...row });
          continue;
        }
        for (const [measure, aggregate] of Object.entries(query.select)) {
          existing[measure] = this.mergeValue(
            Number(existing[measure] ?? 0),
            Number(row[measure] ?? 0),
            aggregate,
          );
        }
      }
    }

    let rows = [...merged.values()];

    if (query.orderBy) {
      const { key, direction } = query.orderBy;
      rows.sort((a, b) => {
        const left = a[key];
        const right = b[key];
        const comparison =
          typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left).localeCompare(String(right));
        return direction === "desc" ? -comparison : comparison;
      });
    }

    if (query.limit !== undefined) rows = rows.slice(0, query.limit);

    return {
      rows,
      // Always `true` on this provider — see the class doc and this
      // method's own doc. There is no merge outcome that earns
      // `estimated: false` here; only `OrmAnalyticsProvider` running on its
      // own, never touched by Analytics Engine at all, can report that.
      estimated: true,
      sampleInterval: hot.rows.length > 0 ? hot.sampleInterval : undefined,
    };
  }

  protected mergeValue(
    left: number,
    right: number,
    aggregate: AnalyticsAggregate,
  ): number {
    if (aggregate === "sum") return left + right;
    throw new AlephaError(`Received an unknown aggregate '${aggregate}'.`);
  }

  /**
   * Never a bare `sum()`: the sample interval varies per row, so the
   * correction has to live inside the aggregate expression itself. The
   * `AlephaError` branch is defence in depth — `AnalyticsQuery` types
   * `select`'s values as {@link AnalyticsAggregate}, but a query built from
   * unchecked request input (`select[key] = req.query.aggregate`) could
   * still hand this a string the type system never sees.
   */
  protected aggregateExpression(
    aggregate: AnalyticsAggregate,
    slot: string,
  ): string {
    if (aggregate === "sum") return `sum(${slot} * _sample_interval)`;
    throw new AlephaError(`Received an unknown aggregate '${aggregate}'.`);
  }

  /**
   * The write binding, or a clear error naming exactly what is missing.
   * There is no REST fallback for writes the way `CloudflareEmailProvider`
   * has one for sending — Analytics Engine's SQL API is read-only.
   */
  protected requireBinding(): AnalyticsEngineDataset {
    if (this.binding) return this.binding;
    const name = this.env.CLOUDFLARE_ANALYTICS_DATASET;
    throw new AlephaError(
      !name
        ? "Cannot write to Analytics Engine: CLOUDFLARE_ANALYTICS_DATASET is not set."
        : `Cannot write to Analytics Engine: binding '${WaeAnalyticsProvider.BINDING}' was not found in the Workers environment at start() (dataset '${name}'). Is this running on Workers with a matching wrangler.toml entry?`,
    );
  }

  protected requireDatasetName(): string {
    const name = this.env.CLOUDFLARE_ANALYTICS_DATASET;
    if (!name) {
      throw new AlephaError(
        "Cannot query Analytics Engine: CLOUDFLARE_ANALYTICS_DATASET is not set.",
      );
    }
    return name;
  }

  /**
   * Lazily builds (and caches) the read-side client from
   * `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_ANALYTICS_TOKEN` — the same "construct on
   * first real use, from env, with a clear error if the credentials are
   * missing" shape as `CloudflareEmailProvider.sendViaRest`'s account
   * id/token check.
   */
  protected sql(): AnalyticsEngineSql {
    if (this.sqlClient) return this.sqlClient;
    const accountId = this.env.CLOUDFLARE_ACCOUNT_ID;
    const token = this.env.CLOUDFLARE_ANALYTICS_TOKEN;
    if (!accountId || !token) {
      throw new AlephaError(
        "Cannot query Analytics Engine: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_ANALYTICS_TOKEN must both be set.",
      );
    }
    this.sqlClient = new AnalyticsEngineSql({
      accountId,
      token,
      // Cast needed because `AnalyticsEngineSqlOptions.fetch` is typed as
      // `typeof globalThis.fetch` — the whole global function object,
      // `preconnect` static and all — while a bound instance method can only
      // ever satisfy the call signature. `httpFetch` itself keeps the plain,
      // overridable call signature, which is what test subclasses replace.
      fetch: ((input, init) => this.httpFetch(input, init)) as typeof fetch,
    });
    return this.sqlClient;
  }

  /**
   * The single HTTP seam for reads, isolated so tests can substitute it
   * without patching global fetch — the same shape as
   * `CloudflareEmailProvider.httpPost`.
   */
  protected async httpFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    return fetch(input, init);
  }
}
