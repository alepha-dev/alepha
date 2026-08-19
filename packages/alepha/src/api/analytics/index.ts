import { $module } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AdminAnalyticsController } from "./controllers/AdminAnalyticsController.ts";
import { AnalyticsRollupJobs } from "./jobs/AnalyticsRollupJobs.ts";
import { $analytics } from "./primitives/$analytics.ts";
import { AnalyticsProvider } from "./providers/AnalyticsProvider.ts";
import { MemoryAnalyticsProvider } from "./providers/MemoryAnalyticsProvider.ts";
import { OrmAnalyticsProvider } from "./providers/OrmAnalyticsProvider.ts";
import { AdminAnalyticsService } from "./services/AdminAnalyticsService.ts";
import { AnalyticsRetentionGuard } from "./services/AnalyticsRetentionGuard.ts";

export * from "./controllers/AdminAnalyticsController.ts";
export * from "./jobs/AnalyticsRollupJobs.ts";
export * from "./planner/AnalyticsBuckets.ts";
export * from "./planner/AnalyticsSlotMap.ts";
export * from "./primitives/$analytics.ts";
export * from "./providers/AnalyticsProvider.ts";
export * from "./providers/MemoryAnalyticsProvider.ts";
export * from "./providers/OrmAnalyticsProvider.ts";
export * from "./providers/WaeAnalyticsProvider.ts";
export * from "./schemas/adminAnalyticsQuerySchema.ts";
export * from "./schemas/adminAnalyticsResultSchema.ts";
export * from "./schemas/adminDatasetSchema.ts";
export * from "./schemas/analyticsDatasetSchema.ts";
export * from "./schemas/analyticsQuerySchema.ts";
export * from "./services/AdminAnalyticsService.ts";
export * from "./services/AnalyticsEngineSql.ts";
export * from "./services/AnalyticsRetentionGuard.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Portable analytics datasets.
 *
 * Binds the relational provider under Node, and the memory provider under
 * test. `WaeAnalyticsProvider` is exported here too, and - unlike its first
 * design - it is now DI-constructible like any other provider (see its class
 * doc). It is still never auto-wired by *this* module's `register()`, though:
 * its write path reads a `cloudflare.env` binding that only exists inside a
 * Worker, so selecting it under Node would mean every `record()` call throws.
 * `index.workerd.ts` is the entry that selects it, gated on
 * `CLOUDFLARE_ANALYTICS_DATASET`.
 *
 * `AnalyticsRollupJobs` is deliberately **not** wired here - see
 * {@link AlephaApiAnalyticsRollup} just below for why it is a separate module.
 * `AnalyticsRetentionGuard` *is* wired here, unconditionally, precisely to
 * catch an app that forgets the split: it `log.warn`s at boot if any
 * dataset declares `retention.hot` while no `AnalyticsRollupJobs` was ever
 * constructed.
 *
 * @module alepha.api.analytics
 */
export const AlephaApiAnalytics = $module({
  name: "alepha.api.analytics",
  primitives: [$analytics],
  // AnalyticsProvider is the abstract seam and is always auto-injected; the
  // concrete implementations are `variants` (module-tagged, not auto-injected)
  // so only the one `register()` selects below is ever instantiated — the
  // same shape as `AlephaBucket`'s `FileStorageProvider` seam.
  //
  // No `imports: [AlephaOrm]` here, deliberately. `OrmAnalyticsProvider`
  // itself is tagged with `AlephaOrm`'s module metadata through the
  // `DatabaseProvider`/`Repository` it injects (`alepha/orm`'s own
  // `variants`), so `AlephaOrm` auto-wires the moment `OrmAnalyticsProvider`
  // is actually constructed — never in test mode, where `MemoryAnalyticsProvider`
  // is the substitution and `OrmAnalyticsProvider` is never touched. An
  // eager `imports: [AlephaOrm]` here would wire the SQLite/D1 driver
  // unconditionally, even under `MemoryAnalyticsProvider`, and it would do so
  // using whatever `DATABASE_URL` happens to be set — which in this repo's
  // test environment is a Postgres URL that the default SQLite driver cannot
  // parse.
  services: [AnalyticsProvider, AnalyticsRetentionGuard],
  variants: [MemoryAnalyticsProvider, OrmAnalyticsProvider],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: AnalyticsProvider,
      use: alepha.isTest() ? MemoryAnalyticsProvider : OrmAnalyticsProvider,
    });
  },
});

/**
 * The hourly retention sweep, as its own module.
 *
 * Not folded into {@link AlephaApiAnalytics} above, even though the plan this
 * shipped from asked for exactly that. `AnalyticsRollupJobs` uses `$job`,
 * and `$job` is never test-substituted the way `AnalyticsProvider` is:
 * `JobProvider` holds a real `$repository(jobExecutionEntity)`, so
 * `alepha/api/jobs` always needs a working `DatabaseProvider`, in every
 * environment including tests (see `$job.spec.ts` / `AuditJobs.spec.ts`,
 * which both explicitly attach `AlephaOrmPostgres` for exactly this reason).
 *
 * Folding `imports: [AlephaApiJobs]` and `services: [AnalyticsRollupJobs]`
 * into `AlephaApiAnalytics` was tried first, and it broke `analytics.spec.ts`
 * outright: `$module.register()` wires `imports[]` and auto-injects every
 * `services[]` entry unconditionally, so merely declaring one `$analytics()`
 * field anywhere — the one thing this package promises works with no
 * database at all — started requiring a live Postgres connection to boot.
 * Nine tests failed with "Postgres URL is not supported for SQLite
 * provider" before this was caught.
 *
 * Splitting it out preserves the invariant `AlephaApiAnalytics`'s own doc
 * already states for `AlephaOrm`: nothing here is real infrastructure until
 * something asks for it. An app that wants the scheduled sweep imports this
 * module explicitly, alongside `AlephaApiAnalytics` — the same relationship
 * `AlephaApiJobsQueue` already has to `AlephaApiJobs`.
 *
 * That relationship is not quite as safe as it sounds, though.
 * `AlephaApiJobsQueue` is additive — omit it and `$job` still runs, just in
 * direct mode instead of through a real queue. Omitting *this* module is not
 * additive: `retention` simply does nothing, forever, with no fallback and
 * no error. `AnalyticsRetentionGuard` (wired unconditionally into
 * `AlephaApiAnalytics` above) exists specifically to catch that: it warns at
 * boot if any dataset declares `retention.hot` while no `AnalyticsRollupJobs`
 * was ever constructed.
 *
 * @module alepha.api.analytics.rollup
 */
export const AlephaApiAnalyticsRollup = $module({
  name: "alepha.api.analytics.rollup",
  imports: [AlephaApiJobs],
  services: [AnalyticsRollupJobs],
});

/**
 * Opt-in admin surface: dataset listing + validated aggregate queries at
 * `/api/admin/analytics/*`, gated on `admin:analytics:read`.
 *
 * A separate module for the same reason {@link AlephaApiAnalyticsRollup} is
 * one: `$analytics()` auto-wires {@link AlephaApiAnalytics} the moment a
 * dataset is declared, and declaring a dataset must never force HTTP
 * endpoints onto an app. Register it explicitly, next to your server module.
 *
 * @module alepha.api.analytics.admin
 */
export const AlephaApiAnalyticsAdmin = $module({
  name: "alepha.api.analytics.admin",
  services: [AdminAnalyticsService, AdminAnalyticsController],
});
