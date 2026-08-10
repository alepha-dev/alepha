import { $module } from "alepha";
import { $analytics } from "./primitives/$analytics.ts";
import { AnalyticsProvider } from "./providers/AnalyticsProvider.ts";
import { MemoryAnalyticsProvider } from "./providers/MemoryAnalyticsProvider.ts";
import { OrmAnalyticsProvider } from "./providers/OrmAnalyticsProvider.ts";

export * from "./planner/AnalyticsBuckets.ts";
export * from "./planner/AnalyticsSlotMap.ts";
export * from "./primitives/$analytics.ts";
export * from "./providers/AnalyticsProvider.ts";
export * from "./providers/MemoryAnalyticsProvider.ts";
export * from "./providers/OrmAnalyticsProvider.ts";
export * from "./providers/WaeAnalyticsProvider.ts";
export * from "./schemas/analyticsDatasetSchema.ts";
export * from "./schemas/analyticsQuerySchema.ts";
export * from "./services/AnalyticsEngineSql.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Portable analytics datasets.
 *
 * Binds the relational provider under Node, and the memory provider under
 * test. `WaeAnalyticsProvider` is exported here too, and — unlike its first
 * design — it is now DI-constructible like any other provider (see its class
 * doc). It is still never auto-wired by *this* module's `register()`, though:
 * its write path reads a `cloudflare.env` binding that only exists inside a
 * Worker, so selecting it under Node would mean every `record()` call throws.
 * `index.workerd.ts` is the entry that selects it, gated on
 * `CLOUDFLARE_ANALYTICS_DATASET`.
 *
 * @module alepha.analytics
 */
export const AlephaAnalytics = $module({
  name: "alepha.analytics",
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
  services: [AnalyticsProvider],
  variants: [MemoryAnalyticsProvider, OrmAnalyticsProvider],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: AnalyticsProvider,
      use: alepha.isTest() ? MemoryAnalyticsProvider : OrmAnalyticsProvider,
    });
  },
});
