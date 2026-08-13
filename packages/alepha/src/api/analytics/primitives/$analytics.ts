import { $inject, AlephaError, createPrimitive, KIND, Primitive } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AnalyticsBuckets } from "../planner/AnalyticsBuckets.ts";
import { AnalyticsSlotMap } from "../planner/AnalyticsSlotMap.ts";
import { AnalyticsProvider } from "../providers/AnalyticsProvider.ts";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";
import type {
  AnalyticsQuery,
  AnalyticsResult,
} from "../schemas/analyticsQuerySchema.ts";
import { AnalyticsEntityFactory } from "../services/AnalyticsEntityFactory.ts";

/**
 * Declares an analytics dataset: what you record, and what you can ask.
 *
 * The same declaration runs on Workers Analytics Engine, on a relational
 * database and in memory. Which one is bound is a runtime decision made by the
 * module, so app code never names a backend.
 *
 * @example
 * ```ts
 * class PageViews {
 *   views = $analytics({
 *     index: "app",
 *     dimensions: z.object({ app: z.text(), path: z.text(), country: z.text() }),
 *     measures: z.object({ count: z.integer() }),
 *     retention: { hot: "60d", rollup: "day", cold: "400d" },
 *   });
 *
 *   async onPageView(app: string, path: string, country: string) {
 *     await this.views.record({ app, path, country, count: 1 });
 *   }
 *
 *   async topPaths(app: string) {
 *     return this.views.query({
 *       since: "2026-01-01",
 *       where: { app },
 *       groupBy: ["path"],
 *       select: { count: "sum" },
 *       orderBy: { key: "count", direction: "desc" },
 *       limit: 20,
 *     });
 *   }
 * }
 * ```
 */
export const $analytics = (options: AnalyticsPrimitiveOptions) =>
  createPrimitive(AnalyticsPrimitive, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface AnalyticsPrimitiveOptions
  extends Omit<AnalyticsDataset, "name"> {
  /**
   * Storage-facing dataset name. Defaults to the property key it is declared
   * on, the same way `$storage` names a bucket.
   *
   * Must be snake_case — lowercase letters, digits and underscores, starting
   * with a letter — because it becomes a relational table name fragment and
   * the Analytics Engine `blob1` discriminator. A camelCase property key
   * (the convention every other class field in this codebase uses) is
   * rejected at `onInit`; pass an explicit snake_case `name` here to keep a
   * camelCase property.
   */
  name?: string;
}

// ---------------------------------------------------------------------------------------------------------------------

export class AnalyticsPrimitive extends Primitive<AnalyticsPrimitiveOptions> {
  /**
   * What a dataset name is allowed to look like on every backend: lowercase
   * letters, digits and underscores, starting with a letter.
   *
   * Identical to the pattern `AnalyticsEntityFactory` enforces for the
   * relational backend — that check stays in place as defence in depth, but
   * it is unreachable from `MemoryAnalyticsProvider.register()`, which is a
   * no-op. Tests run in test mode, where memory is the bound provider, so
   * without this check here a camelCase property key — the convention every
   * other class field in this codebase uses — would pass silently under
   * every test and only fail once the app actually runs against a relational
   * or Analytics Engine backend.
   */
  public static readonly NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

  protected readonly provider = $inject(AnalyticsProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  public get dataset(): AnalyticsDataset {
    return {
      ...this.options,
      name: this.options.name ?? this.config.propertyKey,
    };
  }

  /**
   * Validates the dataset and registers it with the bound provider.
   *
   * `onInit` rather than a lifecycle hook or first use, and synchronous by
   * requirement of the base class. Five things have to happen here, in
   * order:
   *
   * - The name has to be legal on every backend before anything else runs,
   *   since a rejected name should never reach a provider's `register()`.
   * - No dimension/measure name may collide with a reserved word or with each
   *   other — see {@link AnalyticsEntityFactory.assertNoCollisions}. That
   *   check used to be reachable only from `OrmAnalyticsProvider.register()`
   *   (via its own `AnalyticsEntityFactory.build()`), so a dataset with a
   *   `day` dimension, say, passed every test under `MemoryAnalyticsProvider`
   *   (the bound provider in test mode, whose `register()` never calls the
   *   factory) and only threw once a relational or Analytics Engine
   *   deployment registered it in production. Running it here, ahead of
   *   every provider's own `register()`, makes the check backend-independent
   *   the same way {@link assertLegalName} already is.
   * - `retention` has to describe a boundary that can actually be enforced
   *   safely — see {@link assertValidRetention} — before anything downstream
   *   (a provider's `register()`, `AnalyticsRollupJobs`) trusts it.
   * - The slot caps and the index check are cheap, and their failure mode is a
   *   wire format that silently misreads stored rows — so they are asserted at
   *   boot rather than at the first write.
   * - Registration must precede `alepha.start()`. The container locks once
   *   `started` flips (`Alepha.ts:1079`), and a relational provider's
   *   `migrate()` runs from its own `"start"` hook
   *   (`PostgresProvider.ts:91-106`), so a dataset registered any later has no
   *   table and cannot get one. This is the same rule `Repository`'s own
   *   constructor follows (`Repository.ts:123-127`).
   */
  protected onInit(): void {
    this.assertLegalName();
    AnalyticsEntityFactory.assertNoCollisions(this.dataset);
    this.assertValidRetention();
    AnalyticsSlotMap.forDataset(this.dataset);
    this.provider.register(this.dataset);
  }

  /**
   * Refuses a dataset name that is not legal snake_case.
   *
   * The message names both ways out — rename the property, or pass an
   * explicit `name` — rather than just describing what is wrong, because a
   * camelCase property key is normal Alepha style everywhere else in this
   * codebase; the fix is not obvious without being told.
   *
   * Deliberately does not auto-convert camelCase to snake_case on the
   * caller's behalf: the name is the `blob1` discriminator written to
   * Analytics Engine, so a stored value silently different from what the
   * developer wrote in source would be confusing when reading raw data back.
   */
  protected assertLegalName(): void {
    const name = this.dataset.name;
    if (AnalyticsPrimitive.NAME_PATTERN.test(name)) {
      return;
    }

    throw new AlephaError(
      `Dataset name '${name}' must be snake_case: lowercase letters, digits ` +
        "and underscores, starting with a letter. It becomes a table name " +
        "and the Analytics Engine dataset discriminator, so it cannot be " +
        `camelCase. Either rename the property to '${AnalyticsPrimitive.toSnakeCase(name)}', ` +
        'or pass an explicit { name: "..." }.',
    );
  }

  /**
   * Refuses a `retention.cold` shorter than `retention.hot`.
   *
   * `AnalyticsRollupJobs` only ever folds up to the hot cutoff — see its
   * `rollupBoundary` — so if `cold` names a boundary more recent than that,
   * the very same sweep would prune rows in `[coldCutoff, hotCutoff)` that
   * were never rolled up: still hour-precision, still inside the window
   * `hot` promises, deleted outright instead of folded. That breaks the one
   * invariant this whole feature exists to keep — no total the UI shows may
   * change, only the time-axis resolution — so it is rejected here, at boot,
   * rather than left to `prune()` to silently eat rows the first time the
   * sweep runs.
   *
   * A no-op whenever either bound is absent: `cold` without `hot` has
   * nothing to be shorter than (and does nothing on its own either, since
   * `AnalyticsRollupJobs.sweepDataset` skips any dataset without `hot`).
   */
  protected assertValidRetention(): void {
    const retention = this.dataset.retention;
    if (!retention?.hot || !retention?.cold) {
      return;
    }

    const hotMillis = AnalyticsBuckets.parseWindow(retention.hot);
    const coldMillis = AnalyticsBuckets.parseWindow(retention.cold);
    if (coldMillis >= hotMillis) {
      return;
    }

    throw new AlephaError(
      `Dataset '${this.dataset.name}' declares retention.cold ('${retention.cold}') ` +
        `shorter than retention.hot ('${retention.hot}'). The sweep only ever rolls up ` +
        "to the hot cutoff, so a shorter cold window would prune rows before they are " +
        "ever folded — 'cold' must be at least as long as 'hot'.",
    );
  }

  /**
   * camelCase to snake_case, for the rename {@link assertLegalName} suggests
   * in its error message.
   *
   * A pure function, kept `static` rather than a free function — this
   * codebase never declares code outside a class.
   */
  public static toSnakeCase(value: string): string {
    return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  }

  public async record(
    row: Record<string, string | number> & { hour?: string },
  ): Promise<void> {
    await this.recordMany([row]);
  }

  /**
   * Records a batch.
   *
   * `hour` is stamped from {@link DateTimeProvider} unless the caller supplies
   * one. The override is load-bearing rather than a convenience: Analytics
   * Engine stamps its own `timestamp` at write time and cannot backdate a
   * point, so a batched or retried envelope has to carry the bucket it
   * computed or it lands in the wrong hour for reasons unrelated to sampling.
   */
  public async recordMany(
    rows: Array<Record<string, string | number> & { hour?: string }>,
  ): Promise<void> {
    const fallback = AnalyticsBuckets.hour(this.dateTime.nowMillis());
    await this.provider.record(
      this.dataset,
      rows.map((row) => ({ ...row, hour: row.hour ?? fallback })),
    );
  }

  public query(query: AnalyticsQuery): Promise<AnalyticsResult> {
    return this.provider.query(this.dataset, query);
  }
}

$analytics[KIND] = AnalyticsPrimitive;
