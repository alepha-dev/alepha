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
 * Portable analytics datasets, on Cloudflare.
 *
 * Auto-wires the same default as the Node entry (`index.ts`): the relational
 * provider outside test mode, the memory provider under it. A Worker with D1
 * but no Analytics Engine binding is a valid deployment, and it should keep
 * exact numbers rather than fail to boot — which rules out treating
 * `WaeAnalyticsProvider` as this module's default the way `AlephaBucket`
 * defaults to R2 under its own `index.workerd.ts`.
 *
 * That is also a structural requirement, not just a safe default:
 * `WaeAnalyticsProvider` takes its Analytics Engine binding and SQL
 * credentials as constructor options rather than `$inject`/`$env` fields
 * (see its class doc), so nothing here can construct one generically the way
 * `alepha.with({ provide, use: SomeInjectableClass })` constructs
 * `OrmAnalyticsProvider`. This module exports it — unlike `index.ts`, which
 * does not — so an app's own Cloudflare bootstrap can read the real
 * `analytics_engine_datasets` binding (the same way `R2FileStorageProvider`
 * reads `cloudflare.env` at `start`), construct `WaeAnalyticsProvider`
 * explicitly with a `cold` fallback, and substitute it in with
 * `alepha.with({ provide: AnalyticsProvider, use: () => waeInstance })` —
 * or an equivalent injectable wrapper — itself.
 *
 * @module alepha.analytics
 */
export const AlephaAnalytics = $module({
  name: "alepha.analytics",
  primitives: [$analytics],
  // AnalyticsProvider is the abstract seam and is always auto-injected; the
  // concrete implementations are `variants` (module-tagged, not
  // auto-injected) so only the one `register()` selects below is ever
  // instantiated — see `index.ts` for why `OrmAnalyticsProvider` is never
  // eagerly imported here either. `WaeAnalyticsProvider` is deliberately
  // absent from this list: unlike the other two, it has no DI-constructible
  // shape for `register()` to select, so listing it here would be no more
  // than a stale hint that it can be `.with({ use: ... })`'d the same way —
  // it cannot.
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
