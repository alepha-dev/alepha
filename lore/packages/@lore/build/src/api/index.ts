import { LoreCoreApi } from "@lore/core/api";
import { $module } from "alepha";

import { QualityController } from "./controllers/QualityController.ts";
import { QualityReportsController } from "./controllers/QualityReportsController.ts";
import { QualityJobs } from "./jobs/QualityJobs.ts";
import { BuildDashboardMetrics } from "./services/BuildDashboardMetrics.ts";
import { BuildProjectEvents } from "./services/BuildProjectEvents.ts";
import { BuildProjectMerge } from "./services/BuildProjectMerge.ts";
import { BuildReportsSummary } from "./services/BuildReportsSummary.ts";
import { CoverageThreshold } from "./services/CoverageThreshold.ts";
import { ProjectQualityReportService } from "./services/ProjectQualityReportService.ts";
import { QualityNumericCatalog } from "./services/QualityNumericCatalog.ts";
import { QualityNumericMetrics } from "./services/QualityNumericMetrics.ts";
import { QualityService } from "./services/QualityService.ts";
import { QualityTrendMetric } from "./services/QualityTrendMetric.ts";

/**
 * The server half of `@lore/build`, Lore's fourth pillar: the code a project
 * holds, its git repositories, and Quality, which measures that code (moved
 * from `@lore/ship`, #E162).
 *
 * It depends on `@lore/core` only: a feature that spans two modules goes
 * through a core registry or a core link, never through an import of another
 * feature module (`check:conventions`).
 *
 * Registered by `apps/lore/src/main.server.ts`, after every entry-level
 * substitution, between Remember and Ship.
 *
 * @module
 */
export const LoreBuildApi = $module({
  name: "lore.build.api",
  // Core first: booting this module alone boots what it depends on.
  imports: [LoreCoreApi],
  services: [
    // Build's project events in the core catalog; listed because nothing
    // injects them.
    BuildProjectEvents,
    // Registers its Reports Summary line and its project merge step;
    // nothing injects them.
    BuildReportsSummary,
    BuildProjectMerge,
    // The tiles: the trend and the numbers, and their resolvers.
    BuildDashboardMetrics,
    QualityTrendMetric,
    QualityNumericCatalog,
    QualityNumericMetrics,
    QualityJobs,
    QualityService,
    CoverageThreshold,
    ProjectQualityReportService,
    QualityController,
    QualityReportsController,
  ],
});

export { QualityController } from "./controllers/QualityController.ts";
export { QualityReportsController } from "./controllers/QualityReportsController.ts";
export { QualityJobs } from "./jobs/QualityJobs.ts";
export { CoverageThreshold } from "./services/CoverageThreshold.ts";
export { QualityService } from "./services/QualityService.ts";
