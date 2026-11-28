import { LoreCoreApi } from "@lore/core/api";
import { $module } from "alepha";

import { AppController } from "./controllers/AppController.ts";
import { AppSecretController } from "./controllers/AppSecretController.ts";
import { ArtifactController } from "./controllers/ArtifactController.ts";
import { BackupController } from "./controllers/BackupController.ts";
import { DeliveryReportsController } from "./controllers/DeliveryReportsController.ts";
import { DeployController } from "./controllers/DeployController.ts";
import { HostPullController } from "./controllers/HostPullController.ts";
import { InsightsController } from "./controllers/InsightsController.ts";
import { LiveQuestController } from "./controllers/LiveQuestController.ts";
import { MonitorController } from "./controllers/MonitorController.ts";
import { ProjectErrorController } from "./controllers/ProjectErrorController.ts";
import { ProjectErrorThreadController } from "./controllers/ProjectErrorThreadController.ts";
import { RegistryCredentialController } from "./controllers/RegistryCredentialController.ts";
import { SigilAnalyticsController } from "./controllers/SigilAnalyticsController.ts";
import { SigilController } from "./controllers/SigilController.ts";
import { SigilIngestController } from "./controllers/SigilIngestController.ts";
import { StackController } from "./controllers/StackController.ts";
import { StackDeployController } from "./controllers/StackDeployController.ts";
import { StackVariableController } from "./controllers/StackVariableController.ts";
import { UptimePushController } from "./controllers/UptimePushController.ts";
import { WorkflowController } from "./controllers/WorkflowController.ts";
import { DeployJobs } from "./jobs/DeployJobs.ts";
import { HostCredentialJobs } from "./jobs/HostCredentialJobs.ts";
import { ProjectErrorJobs } from "./jobs/ProjectErrorJobs.ts";
import { SigilJobs } from "./jobs/SigilJobs.ts";
import { UptimeJobs } from "./jobs/UptimeJobs.ts";
import { UptimeRetentionJobs } from "./jobs/UptimeRetentionJobs.ts";
import { AppHealthMetric } from "./services/AppHealthMetric.ts";
import { AppSecretService } from "./services/AppSecretService.ts";
import { AppService } from "./services/AppService.ts";
import { ArtifactDetailService } from "./services/ArtifactDetailService.ts";
import { ArtifactLimits } from "./services/ArtifactLimits.ts";
import { ArtifactPushCaps } from "./services/ArtifactPushCaps.ts";
import { ArtifactService } from "./services/ArtifactService.ts";
import { ArtifactTarReader } from "./services/ArtifactTarReader.ts";
import { BackupFreshnessMetric } from "./services/BackupFreshnessMetric.ts";
import { BayRemovalService } from "./services/BayRemovalService.ts";
import { CertExpiryMetric } from "./services/CertExpiryMetric.ts";
import { CloudflareProbeService } from "./services/CloudflareProbeService.ts";
import { CommitQuestSetService } from "./services/CommitQuestSetService.ts";
import { DailyVisitorsService } from "./services/DailyVisitorsService.ts";
import { DeployAppsDashboardMetrics } from "./services/DeployAppsDashboardMetrics.ts";
import { DeployAttentionSources } from "./services/DeployAttentionSources.ts";
import { DeployBuckets } from "./services/DeployBuckets.ts";
import { DeployBuiltTags } from "./services/DeployBuiltTags.ts";
import { DeployDashboard } from "./services/DeployDashboard.ts";
import { DeployDashboardMetrics } from "./services/DeployDashboardMetrics.ts";
import { DeployedBuildService } from "./services/DeployedBuildService.ts";
import { DeployGate } from "./services/DeployGate.ts";
import { DeployHostUsage } from "./services/DeployHostUsage.ts";
import { DeployLimits } from "./services/DeployLimits.ts";
import { DeployProjectCounts } from "./services/DeployProjectCounts.ts";
import { DeployProjectDeletion } from "./services/DeployProjectDeletion.ts";
import { DeployProjectMerge } from "./services/DeployProjectMerge.ts";
import { DeployRegistry } from "./services/DeployRegistry.ts";
import { DeployReportsSummary } from "./services/DeployReportsSummary.ts";
import { DeployRunner } from "./services/DeployRunner.ts";
import { DeployService } from "./services/DeployService.ts";
import { ErrorThreshold } from "./services/ErrorThreshold.ts";
import { ErrorTrendMetric } from "./services/ErrorTrendMetric.ts";
import { HostCloudflareService } from "./services/HostCloudflareService.ts";
import { IncidentsMetric } from "./services/IncidentsMetric.ts";
import { LiveQuestService } from "./services/LiveQuestService.ts";
import { OpenErrorCounter } from "./services/OpenErrorCounter.ts";
import { OpenErrorsMetric } from "./services/OpenErrorsMetric.ts";
import { ProjectDeliveryReportService } from "./services/ProjectDeliveryReportService.ts";
import { ProjectErrorQuestHandBack } from "./services/ProjectErrorQuestHandBack.ts";
import { ProjectErrorRuleService } from "./services/ProjectErrorRuleService.ts";
import { ProjectErrorThread } from "./services/ProjectErrorThread.ts";
import { ProjectReliabilityReportService } from "./services/ProjectReliabilityReportService.ts";
import { RecentDeploymentsMetric } from "./services/RecentDeploymentsMetric.ts";
import { RegistryCredentialService } from "./services/RegistryCredentialService.ts";
import { RollbackService } from "./services/RollbackService.ts";
import { RunErrorService } from "./services/RunErrorService.ts";
import { ShipErrorPrompts } from "./services/ShipErrorPrompts.ts";
import { ShipHostCommands } from "./services/ShipHostCommands.ts";
import { ShipProjectEvents } from "./services/ShipProjectEvents.ts";
import { ShipPromptChecks } from "./services/ShipPromptChecks.ts";
import { SigilIngestRefusals } from "./services/SigilIngestRefusals.ts";
import { SigilIngestService } from "./services/SigilIngestService.ts";
import { SigilInsightsService } from "./services/SigilInsightsService.ts";
import { SigilTokenService } from "./services/SigilTokenService.ts";
import { SigilVisitService } from "./services/SigilVisitService.ts";
import { StackBundleReader } from "./services/StackBundleReader.ts";
import { StackComposeParser } from "./services/StackComposeParser.ts";
import { StackConsoleService } from "./services/StackConsoleService.ts";
import { StackDeployService } from "./services/StackDeployService.ts";
import { StackService } from "./services/StackService.ts";
import { StackTargets } from "./services/StackTargets.ts";
import { StackVariableService } from "./services/StackVariableService.ts";
import { UniqueVisitorsMetric } from "./services/UniqueVisitorsMetric.ts";
import { UptimeHttpProber } from "./services/UptimeHttpProber.ts";
import { UptimeLatencyMetric } from "./services/UptimeLatencyMetric.ts";
import { UptimeMetric } from "./services/UptimeMetric.ts";
import { UptimeSocketProber } from "./services/UptimeSocketProber.ts";
import { WebVitalsMetric } from "./services/WebVitalsMetric.ts";
import { WorkflowService } from "./services/WorkflowService.ts";

/**
 * The server half of `@lore/ship`, Lore as Vercel: apps, telemetry (sigils, analytics, vitals, errors), deployments and hosts. Quality is core's since #Q4217.
 *
 * It depends on `@lore/core` only: a feature that spans two modules goes through a core registry or a core link, never through an import of another feature module (`check:conventions`).
 *
 * Registered by `apps/lore/src/main.server.ts`, after every entry-level
 * substitution.
 *
 * @module
 */
export const LoreShipApi = $module({
  name: "lore.ship.api",
  // Core first: booting this module alone boots what it depends on.
  imports: [LoreCoreApi],
  services: [
    // Ship's project events, in the core catalog (#Q3889); listed because
    // nothing injects them.
    ShipProjectEvents,
    // The open-errors threshold (#Q3894): its hourly check registers itself,
    // so the class is listed. The row is core's, coverage Build's (#E162).
    ErrorThreshold,
    // The tags Build's Quality report marks on its curve (#E162).
    DeployBuiltTags,
    // The errors a use case run opens and resolves (#E153), written by
    // Plan's Requirements.
    RunErrorService,
    // Every bucket of the package, at boot: an upload looks its bucket up
    // by name, and the controllers that use one stay pure (#Q3404).
    DeployBuckets,
    DeployReportsSummary,
    DeployDashboardMetrics,
    ProjectErrorQuestHandBack,
    // Registers the `error` subject on core's comments, and holds the event
    // table (#E185): listed so both exist whatever is first asked.
    ProjectErrorThread,
    DeployDashboard,
    // Registers its project merge step (#Q2782); nothing injects it.
    DeployProjectMerge,
    // Frees the hosts a deleted project held (#Q3169); nothing injects it.
    DeployProjectDeletion,
    // Deploy's "needs you" source (#Q2656).
    DeployAttentionSources,
    // The apps tiles of #E77 (#Q2657).
    DeployAppsDashboardMetrics,
    AppHealthMetric,
    ErrorTrendMetric,
    UptimeMetric,
    UptimeLatencyMetric,
    CertExpiryMetric,
    IncidentsMetric,
    DeployProjectCounts,
    // Whether a triage automation has errors to read (#Q4228).
    ShipPromptChecks,
    // The `error` arg, the error view's pins and `investigate-error` (#Q4471).
    ShipErrorPrompts,
    ProjectErrorJobs,
    UptimeRetentionJobs,
    UptimeJobs,
    UptimeHttpProber,
    UptimeSocketProber,
    SigilJobs,
    HostCredentialJobs,
    ArtifactTarReader,
    ArtifactDetailService,
    ArtifactService,
    DeployedBuildService,
    // Live quests (#E154): the quest set of each pushed commit, and the
    // reads registered on core's `LiveQuestRegistry` at boot.
    CommitQuestSetService,
    // The push carries more parts than the framework's default allows.
    ArtifactPushCaps,
    LiveQuestService,
    LiveQuestController,
    // Deploying a stored artifact to a host (epic #1). `DeployRegistry` is
    // the seam #1201 replaces with the `deployments` table; the runner is what
    // writes through it.
    DeployGate,
    ArtifactLimits,
    DeployLimits,
    DeployRegistry,
    DeployRunner,
    DeployService,
    RollbackService,
    DeployJobs,
    DeployController,
    // The one write path for `app_instances`, and the only writer of
    // `sigils.name`, which mirrors it (#1767).
    AppService,
    // One deployed copy's environment (#1813). Sealed at rest, opened only by
    // the deploy, and never read back by any endpoint.
    AppSecretService,
    // Stacks: apps and services deployed together from one compose.yml
    // (#E79). The one write path for stacks, their environments, routes,
    // revisions and members.
    // A project's container registry credentials (#Q2693), sealed and opened
    // only to verify an image and inside a deploy of the same project.
    RegistryCredentialService,
    // The connected repository's GitHub workflows (#Q4366): its
    // `workflow_run` handler registers at start, so it is listed.
    WorkflowService,
    StackComposeParser,
    StackTargets,
    StackBundleReader,
    StackService,
    // A stack environment's variables (#Q2692), sealed like app variables.
    StackVariableService,
    // Stack deploys over the host connector (#Q2694).
    StackDeployService,
    StackConsoleService,
    // Undeploying from a Bay, data kept (#Q3153).
    BayRemovalService,
    ProjectErrorRuleService,
    OpenErrorCounter,
    DailyVisitorsService,
    OpenErrorsMetric,
    UniqueVisitorsMetric,
    WebVitalsMetric,
    RecentDeploymentsMetric,
    BackupFreshnessMetric,
    // The sink half: the token an app presents, and what happens to what it
    // sends. `SigilIngestService` itself holds no repository on any of the
    // aggregate tables: writes go through `SigilVisitService` (sessions and
    // visits) and the `DeployAnalytics` datasets and log (views, vitals, page
    // views). An entity
    // exists, for the migration generator, exactly as long as some
    // `$repository` names it.
    SigilTokenService,
    SigilIngestService,
    SigilVisitService,
    SigilInsightsService,
    // A host's machine secret (`HostTokenService`) is core's since #E166.
    // The credential sealer is listed by core since #E166: a core service
    // listed here would register this module whenever core injects it.
    // What Lore does with a pasted Cloudflare token: mask it for a read
    // path, and prove it against the account it names before any row is
    // written (#1629, #1630). The probe underneath is one authenticated GET
    // over `globalThis.fetch`, and the seam every spec substitutes.
    CloudflareProbeService,
    HostCloudflareService,
    // What Ship deploys to a host and the commands it sends one, told to
    // core's host registries (#E166); nothing injects either.
    DeployHostUsage,
    ShipHostCommands,
    // The command and job queues are core's since #E166 (`HostCommandService`,
    // `HostJobService`).
    DeliveryReportsController,
    ProjectDeliveryReportService,
    ProjectReliabilityReportService,
    ArtifactController,
    AppController,
    AppSecretController,
    StackController,
    StackVariableController,
    StackDeployController,
    RegistryCredentialController,
    WorkflowController,
    SigilController,
    SigilIngestController,
    // The ingest route's refusal log: a hook, so at boot (#Q3404).
    SigilIngestRefusals,
    UptimePushController,
    BackupController,
    HostPullController,
    SigilAnalyticsController,
    InsightsController,
    MonitorController,
    ProjectErrorController,
    ProjectErrorThreadController,
  ],
});

// ---- re-exports, generated by the extraction (#E75) ----

export { AppController } from "./controllers/AppController.ts";
export { AppSecretController } from "./controllers/AppSecretController.ts";
export { ArtifactController } from "./controllers/ArtifactController.ts";
export { BackupController } from "./controllers/BackupController.ts";
export { ProjectErrorController } from "./controllers/ProjectErrorController.ts";
export { ProjectErrorThreadController } from "./controllers/ProjectErrorThreadController.ts";
export { ProjectErrorThread } from "./services/ProjectErrorThread.ts";
export { DeployController } from "./controllers/DeployController.ts";

export { InsightsController } from "./controllers/InsightsController.ts";

export { DeliveryReportsController } from "./controllers/DeliveryReportsController.ts";
export { SigilAnalyticsController } from "./controllers/SigilAnalyticsController.ts";
export { SigilController } from "./controllers/SigilController.ts";
export { StackController } from "./controllers/StackController.ts";
export { StackVariableController } from "./controllers/StackVariableController.ts";
export { StackDeployController } from "./controllers/StackDeployController.ts";
export { RegistryCredentialController } from "./controllers/RegistryCredentialController.ts";
export { WorkflowController } from "./controllers/WorkflowController.ts";
export { DeployAnalytics } from "./entities/deployAnalytics.ts";
export { LiveQuestController } from "./controllers/LiveQuestController.ts";
export { CommitQuestSetService } from "./services/CommitQuestSetService.ts";
export { LiveQuestService } from "./services/LiveQuestService.ts";
export { QuestBitmap } from "./services/QuestBitmap.ts";
export { DeployJobs } from "./jobs/DeployJobs.ts";
export { SigilJobs } from "./jobs/SigilJobs.ts";

export { StackBundleReader } from "./services/StackBundleReader.ts";
export { StackComposeParser } from "./services/StackComposeParser.ts";
export { StackConsoleService } from "./services/StackConsoleService.ts";
export { StackDeployService } from "./services/StackDeployService.ts";
export { StackService } from "./services/StackService.ts";
export { RegistryCredentialService } from "./services/RegistryCredentialService.ts";
export { WorkflowService } from "./services/WorkflowService.ts";
export { StackTargets } from "./services/StackTargets.ts";
export { StackVariableService } from "./services/StackVariableService.ts";
export { AppSecretService } from "./services/AppSecretService.ts";
export { AppService } from "./services/AppService.ts";
export { ArtifactDetailService } from "./services/ArtifactDetailService.ts";
export { ArtifactSchemaStore } from "./services/ArtifactSchemaStore.ts";
export { ArtifactService } from "./services/ArtifactService.ts";
export { ArtifactTarReader } from "./services/ArtifactTarReader.ts";
export { ProjectErrorRuleService } from "./services/ProjectErrorRuleService.ts";
export { CloudflareProbeService } from "./services/CloudflareProbeService.ts";
export { DeployAssetCache } from "./services/DeployAssetCache.ts";
export { DeployGate } from "./services/DeployGate.ts";
export { ArtifactLimits } from "./services/ArtifactLimits.ts";
export { DeployLimits } from "./services/DeployLimits.ts";
export { DeployRegistry } from "./services/DeployRegistry.ts";
export { type DeployRequest, DeployRunner } from "./services/DeployRunner.ts";
export { DeployService } from "./services/DeployService.ts";
export { HostCloudflareService } from "./services/HostCloudflareService.ts";

export { ImageRegistryClient } from "./services/ImageRegistryClient.ts";
export { OpenErrorCounter } from "./services/OpenErrorCounter.ts";
export { RegistryTransport } from "./services/RegistryTransport.ts";
export { RollbackService } from "./services/RollbackService.ts";
export {
  type SchemaChange,
  SchemaCompatibility,
} from "./services/SchemaCompatibility.ts";
export { SigilIngestService } from "./services/SigilIngestService.ts";
export * from "./services/SigilInsightsService.ts";
export * from "./services/SigilVisitService.ts";
export { SigilTokenService } from "./services/SigilTokenService.ts";
export { TeardownService } from "./services/TeardownService.ts";
export { BayRemovalService } from "./services/BayRemovalService.ts";

export { UptimeHttpProber } from "./services/UptimeHttpProber.ts";

export { UptimeSocketProber } from "./services/UptimeSocketProber.ts";

export { UptimeJobs } from "./jobs/UptimeJobs.ts";
export { UptimeProber } from "./services/UptimeProber.ts";
export { UptimeStateService } from "./services/UptimeStateService.ts";

export { UptimePushController } from "./controllers/UptimePushController.ts";
export { UptimePushService } from "./services/UptimePushService.ts";

export { MonitorController } from "./controllers/MonitorController.ts";
// In core since #Q3614; re-exported for the module's own callers.
export { CredentialSealService } from "@lore/core/api";

export { RunErrorService } from "./services/RunErrorService.ts";
export { ErrorThreshold } from "./services/ErrorThreshold.ts";
