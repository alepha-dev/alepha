import { $env, $hook, $inject, Alepha, AlephaError, z } from "alepha";
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
  CLOUDFLARE_API_TOKEN: z
    .text({
      description:
        "API token scoped Account · Account Analytics · Read, for the Analytics Engine SQL read API.",
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
 * `CLOUDFLARE_API_TOKEN`:
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
 * Counts come back as `sum(double * _sample_interval)`, never `count()`, and
 * the result carries `estimated: true` so a UI cannot present them as
 * measurements by accident.
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
 * `rollup`/`prune` delegate to `cold` — but `record()` never writes to `cold`,
 * only to Analytics Engine. Nothing in this class moves a row from hot to
 * cold; that migration (read the folded aggregate off Analytics Engine via
 * `sql().query`, write it into `cold` as an *exact* row even though it
 * started as an *estimate*) is a real, currently unaddressed gap, left for a
 * dedicated scheduled job rather than invented here without a spec for how an
 * estimate becomes a permanent exact number. Delegating still buys two things
 * today: `cold` gets driven on the same schedule as everything else it holds,
 * and both calls stay safe and idempotent no matter when the migration job
 * lands.
 *
 * ## Writes are free of round-trips
 *
 * `writeDataPoint()` returns nothing and is not awaited; the runtime writes in
 * the background. The sequential round-trip cost that dominates a remote
 * database disappears on this path entirely.
 */
export class WaeAnalyticsProvider extends AnalyticsProvider {
  /**
   * Analytics Engine keeps roughly three months.
   */
  public static readonly MAX_HOT_DAYS = 90;

  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(envSchema);
  protected readonly log = $logger();

  /**
   * The durable store for `rollup`/`prune`. The concrete class — see the
   * class doc for why the abstract `AnalyticsProvider` seam would be
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

      const binding = cloudflareEnv[name] as AnalyticsEngineDataset | undefined;
      if (!binding) {
        this.log.warn(
          `Analytics Engine inert: binding '${name}' not found in Workers environment.`,
        );
        return;
      }

      this.binding = binding;
      this.log.info(`Analytics Engine ready (dataset: ${name})`);
    },
  });

  /**
   * The hot tier has nothing to declare — Analytics Engine has no schema to
   * create ahead of time, the same as `MemoryAnalyticsProvider`. Two things
   * still have to happen here rather than at first write:
   *
   * - `retention.hot` is checked now, via {@link assertRetention}. Analytics
   *   Engine silently discards data past ~90 days regardless of what a
   *   dataset declares, so a longer window has to fail loud at declaration
   *   time, not once a report quietly comes up short months later.
   * - `cold` is registered, so its own tables exist before `alepha.start()`
   *   — the same eager-registration rule `OrmAnalyticsProvider` follows.
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

  public async query(
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
          `${slot} IN (${AnalyticsEngineSql.quoteList(filter.inArray)})`,
        );
      } else {
        conditions.push(
          `${slot} = ${AnalyticsEngineSql.quote(filter as string | number)}`,
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
      grouping.push(expression);
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

    const rows = await this.sql().query(`
      SELECT ${projections.join(", ")}
      FROM ${this.requireDatasetName()}
      WHERE ${conditions.join(" AND ")}
      ${grouping.length ? `GROUP BY ${grouping.join(", ")}` : ""}
      HAVING COUNT(*) > 0
    `);

    let sampleInterval = 1;
    const out: Array<Record<string, string | number>> = rows.map((row) => {
      sampleInterval = Math.max(
        sampleInterval,
        AnalyticsEngineSql.num(row, "_si"),
      );
      const record: Record<string, string | number> = {};
      for (const name of groupBy) {
        record[name] = AnalyticsEngineSql.str(row, name);
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
   * Delegated in full to the durable cold provider. See the class doc for
   * what this does and does not achieve.
   */
  public rollup(dataset: AnalyticsDataset, before: string): Promise<void> {
    return this.cold.rollup(dataset, before);
  }

  public prune(dataset: AnalyticsDataset, before: string): Promise<void> {
    return this.cold.prune(dataset, before);
  }

  /**
   * Never `count()`, never a bare `sum()`: the sample interval varies per
   * row, so the correction has to live inside the aggregate expression
   * itself. The `AlephaError` branch is defence in depth — `AnalyticsQuery`
   * types `select`'s values as {@link AnalyticsAggregate}, but a query built
   * from unchecked request input (`select[key] = req.query.aggregate`)
   * could still hand this a string the type system never sees.
   */
  protected aggregateExpression(
    aggregate: AnalyticsAggregate,
    slot: string,
  ): string {
    if (aggregate === "count") return "sum(_sample_interval)";
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
        : `Cannot write to Analytics Engine: binding '${name}' was not found in the Workers environment at start(). Is this running on Workers with a matching wrangler.toml entry?`,
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
   * `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` — the same "construct on
   * first real use, from env, with a clear error if the credentials are
   * missing" shape as `CloudflareEmailProvider.sendViaRest`'s account
   * id/token check.
   */
  protected sql(): AnalyticsEngineSql {
    if (this.sqlClient) return this.sqlClient;
    const accountId = this.env.CLOUDFLARE_ACCOUNT_ID;
    const token = this.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !token) {
      throw new AlephaError(
        "Cannot query Analytics Engine: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must both be set.",
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
