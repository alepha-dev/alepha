import { LorePlanApi } from "@lore/plan/api";
import { LoreRememberApi } from "@lore/remember/api";
import { LoreShipApi } from "@lore/ship/api";
import { $module } from "alepha";

import { PersonaController } from "./controllers/PersonaController.ts";
import { PersonaInsightController } from "./controllers/PersonaInsightController.ts";
import { RequirementController } from "./controllers/RequirementController.ts";
import { RequirementCoverageController } from "./controllers/RequirementCoverageController.ts";
import { RequirementsPromptController } from "./controllers/RequirementsPromptController.ts";
import { RunController } from "./controllers/RunController.ts";
import { UseCaseController } from "./controllers/UseCaseController.ts";
import { RequirementMetricJobs } from "./jobs/RequirementMetricJobs.ts";
import { RequirementsCoverageJobs } from "./jobs/RequirementsCoverageJobs.ts";
import { RequirementsRetentionJobs } from "./jobs/RequirementsRetentionJobs.ts";
import { PersonaResourceKind } from "./resources/PersonaResourceKind.ts";
import { RequirementResourceKind } from "./resources/RequirementResourceKind.ts";
import { UseCaseResourceKind } from "./resources/UseCaseResourceKind.ts";
import { PersonaInsightService } from "./services/PersonaInsightService.ts";
import { RequirementCoverageService } from "./services/RequirementCoverageService.ts";
import { RequirementMetricService } from "./services/RequirementMetricService.ts";
import { RequirementsAttentionSources } from "./services/RequirementsAttentionSources.ts";
import { RequirementsBuckets } from "./services/RequirementsBuckets.ts";
import { RequirementsCommentService } from "./services/RequirementsCommentService.ts";
import { RequirementsCoverageSnapshot } from "./services/RequirementsCoverageSnapshot.ts";
import { RequirementsDashboardMetrics } from "./services/RequirementsDashboardMetrics.ts";
import { RequirementService } from "./services/RequirementService.ts";
import { RequirementsFileAccess } from "./services/RequirementsFileAccess.ts";
import { RequirementsMetricResolvers } from "./services/RequirementsMetricResolvers.ts";
import { RequirementSourceWatcher } from "./services/RequirementSourceWatcher.ts";
import { RequirementsProjectMerge } from "./services/RequirementsProjectMerge.ts";
import { RequirementsPrompts } from "./services/RequirementsPrompts.ts";
import { RequirementsPromptService } from "./services/RequirementsPromptService.ts";
import { RequirementsReleaseGuard } from "./services/RequirementsReleaseGuard.ts";
import { RunService } from "./services/RunService.ts";
import { SourceSectionService } from "./services/SourceSectionService.ts";
import { UseCaseService } from "./services/UseCaseService.ts";

/**
 * The server half of `@lore/plan-requirements`, Plan's Requirements (#E153):
 * personas, use cases, requirements and their runs.
 *
 * It registers on Plan's capability (its option `requirements`), so a reader
 * only ever sees Plan. It is a package of its own because it writes errors
 * and reads telemetry that are Ship's, and reads folio revisions that are
 * Remember's, none of which `@lore/plan` may import. The edges go one way:
 * Plan, Remember and Ship never import it (`check:conventions`).
 *
 * Registered by `apps/lore/src/main.server.ts` after core, plan, remember
 * and ship.
 *
 * @module
 */
export const LorePlanRequirementsApi = $module({
  name: "lore.plan-requirements.api",
  // What it builds on first: booting this module alone boots them.
  imports: [LorePlanApi, LoreRememberApi, LoreShipApi],
  services: [
    // Every bucket of the package, at boot, and who reads each.
    RequirementsBuckets,
    RequirementsFileAccess,
    RunService,
    RequirementsPromptService,
    // Its built-ins and args on core's prompts registry (#Q4343); nothing
    // injects it.
    RequirementsPrompts,
    RequirementsCommentService,
    UseCaseService,
    PersonaInsightService,
    RequirementsRetentionJobs,
    RequirementMetricService,
    RequirementMetricJobs,
    RequirementService,
    RequirementCoverageService,
    RequirementsReleaseGuard,
    RequirementsDashboardMetrics,
    RequirementsMetricResolvers,
    RequirementsAttentionSources,
    RequirementsCoverageSnapshot,
    RequirementsCoverageJobs,
    SourceSectionService,
    // Source changed: Remember's `folio:revision:created`, listened to here.
    RequirementSourceWatcher,
    // The resource kinds on core's `ResourceRegistry`: listed, because
    // nothing injects them.
    PersonaResourceKind,
    UseCaseResourceKind,
    RequirementResourceKind,
    // Its step of a project merge, on core's `ProjectMergeService`.
    RequirementsProjectMerge,
    // Controllers
    PersonaController,
    UseCaseController,
    RequirementController,
    RunController,
    RequirementsPromptController,
    PersonaInsightController,
    RequirementCoverageController,
  ],
});

// What code outside `src/` imports from this barrel.

export { PersonaController } from "./controllers/PersonaController.ts";
export { UseCaseController } from "./controllers/UseCaseController.ts";
export { RequirementController } from "./controllers/RequirementController.ts";
export { RunController } from "./controllers/RunController.ts";
export { PersonaInsightController } from "./controllers/PersonaInsightController.ts";
export { RequirementCoverageController } from "./controllers/RequirementCoverageController.ts";
export { RequirementCoverageService } from "./services/RequirementCoverageService.ts";
export { RequirementsCoverageSnapshot } from "./services/RequirementsCoverageSnapshot.ts";
export { RequirementsDashboardMetrics } from "./services/RequirementsDashboardMetrics.ts";
export { PersonaInsightService } from "./services/PersonaInsightService.ts";
export { RequirementMetricService } from "./services/RequirementMetricService.ts";
export { RequirementsPromptController } from "./controllers/RequirementsPromptController.ts";
export { RequirementsBuckets } from "./services/RequirementsBuckets.ts";
