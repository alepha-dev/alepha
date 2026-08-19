import { $module } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AdminAnalyticsController } from "./controllers/AdminAnalyticsController.ts";
import { AnalyticsRollupJobs } from "./jobs/AnalyticsRollupJobs.ts";
import { $analytics } from "./primitives/$analytics.ts";
import { AnalyticsProvider } from "./providers/AnalyticsProvider.ts";
import { MemoryAnalyticsProvider } from "./providers/MemoryAnalyticsProvider.ts";
import { OrmAnalyticsProvider } from "./providers/OrmAnalyticsProvider.ts";
import { WaeAnalyticsProvider } from "./providers/WaeAnalyticsProvider.ts";
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
 * Portable analytics datasets, on Cloudflare.
 *
 * Binds the Analytics Engine provider when `CLOUDFLARE_ANALYTICS_DATASET` is
 * set, and the relational provider otherwise — a Worker with D1 but no
 * dataset binding is a valid deployment, and it should keep exact numbers
 * rather than fail to boot. The memory provider still wins under
 * `alepha.isTest()`, ahead of both.
 *
 * `WaeAnalyticsProvider` can be selected here — unlike the first draft of
 * this module — because it is now DI-constructible the same way
 * `OrmAnalyticsProvider` is: `$inject`/`$env`/`$hook` fields read the real
 * `analytics_engine_datasets` binding out of `cloudflare.env` at `start()`
 * (the same mechanism `R2FileStorageProvider` uses for its bucket binding),
 * rather than taking it as a constructor argument nothing here could supply.
 * See its class doc for the full design.
 *
 * `AnalyticsRollupJobs` is deliberately **not** wired here - see
 * {@link AlephaApiAnalyticsRollup} just below for why it is a separate module.
 * `AnalyticsRetentionGuard` *is* wired here, unconditionally — see
 * `index.ts` for why.
 *
 * @module alepha.api.analytics
 */
export const AlephaApiAnalytics = $module({
  name: "alepha.api.analytics",
  primitives: [$analytics],
  // AnalyticsProvider is the abstract seam and is always auto-injected; the
  // concrete implementations are `variants` (module-tagged, not
  // auto-injected) so only the one `register()` selects below is ever
  // instantiated — see `index.ts` for why `OrmAnalyticsProvider` is never
  // eagerly imported here either.
  services: [AnalyticsProvider, AnalyticsRetentionGuard],
  variants: [
    MemoryAnalyticsProvider,
    OrmAnalyticsProvider,
    WaeAnalyticsProvider,
  ],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: AnalyticsProvider,
      use: alepha.isTest()
        ? MemoryAnalyticsProvider
        : alepha.env.CLOUDFLARE_ANALYTICS_DATASET
          ? WaeAnalyticsProvider
          : OrmAnalyticsProvider,
    });
  },
});

/**
 * The hourly retention sweep, as its own module — see `index.ts` for the
 * full reasoning (identical here; both entries hit the same DB-cascade
 * problem when this was folded into `AlephaApiAnalytics` directly).
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
