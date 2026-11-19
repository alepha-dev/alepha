import { LoreCoreApi } from "@lore/core/api";
import { $module } from "alepha";

import { ArtifactsGitBackend } from "./backends/ArtifactsGitBackend.ts";
import { GitBackend } from "./backends/GitBackend.ts";
import { LocalGitBackend } from "./backends/LocalGitBackend.ts";
import { CodeRepositoryController } from "./controllers/CodeRepositoryController.ts";
import { GitHttpController } from "./controllers/GitHttpController.ts";
import { QualityController } from "./controllers/QualityController.ts";
import { QualityReportsController } from "./controllers/QualityReportsController.ts";
import { QualityJobs } from "./jobs/QualityJobs.ts";
import { BuildDashboardMetrics } from "./services/BuildDashboardMetrics.ts";
import { BuildProjectDeletion } from "./services/BuildProjectDeletion.ts";
import { BuildProjectEvents } from "./services/BuildProjectEvents.ts";
import { BuildProjectMerge } from "./services/BuildProjectMerge.ts";
import { BuildReportsSummary } from "./services/BuildReportsSummary.ts";
import { CodeRepositoryService } from "./services/CodeRepositoryService.ts";
import { CoverageThreshold } from "./services/CoverageThreshold.ts";
import { GitAccessService } from "./services/GitAccessService.ts";
import { GitReceivePack } from "./services/GitReceivePack.ts";
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
    BuildProjectDeletion,
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
    // Git repositories (#E162): the rows and their API. The backend is
    // chosen per runtime in `register`.
    CodeRepositoryService,
    CodeRepositoryController,
    // git smart HTTP on `.git` URLs (#Q3932).
    GitReceivePack,
    GitAccessService,
    GitHttpController,
  ],
  register: (alepha) => {
    // Artifacts on the Worker, bare repositories on disk everywhere else
    // (Docker, `alepha dev`, the specs). Optional, so a spec substitutes
    // its own first.
    alepha.with({
      optional: true,
      provide: GitBackend,
      use: alepha.isServerless() ? ArtifactsGitBackend : LocalGitBackend,
    });
  },
});

export { ArtifactsGitBackend } from "./backends/ArtifactsGitBackend.ts";
export type {
  ArtifactsBinding,
  ArtifactsRepoHandle,
} from "./backends/ArtifactsGitBackend.ts";
export { GitBackend } from "./backends/GitBackend.ts";
export type {
  GitBackendToken,
  GitRepositoryInfo,
  GitRpcRequest,
  GitRpcResponse,
  GitService,
  GitTokenScope,
} from "./backends/GitBackend.ts";
export { LocalGitBackend } from "./backends/LocalGitBackend.ts";
export { CodeRepositoryController } from "./controllers/CodeRepositoryController.ts";
export { GitHttpController } from "./controllers/GitHttpController.ts";
export { QualityController } from "./controllers/QualityController.ts";
export { QualityReportsController } from "./controllers/QualityReportsController.ts";
export { QualityJobs } from "./jobs/QualityJobs.ts";
export { CodeRepositoryService } from "./services/CodeRepositoryService.ts";
export { GitAccessService } from "./services/GitAccessService.ts";
export { GitReceivePack } from "./services/GitReceivePack.ts";
export { CoverageThreshold } from "./services/CoverageThreshold.ts";
export { QualityService } from "./services/QualityService.ts";
