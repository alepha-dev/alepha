import { LoreCoreApi } from "@lore/core/api";
import { $module } from "alepha";
import { AlephaServerRateLimit } from "alepha/server/rate-limit";
import { AlephaWebSocket } from "alepha/websocket";

import { AdminEstateController } from "./controllers/AdminEstateController.ts";
import { AppController } from "./controllers/AppController.ts";
import { AppSecretController } from "./controllers/AppSecretController.ts";
import { ArtifactController } from "./controllers/ArtifactController.ts";
import { BlightController } from "./controllers/BlightController.ts";
import { DeployController } from "./controllers/DeployController.ts";
import { EstateCommandController } from "./controllers/EstateCommandController.ts";
import { EstateController } from "./controllers/EstateController.ts";
import { EstatePullController } from "./controllers/EstatePullController.ts";
import { EstateSocketController } from "./controllers/EstateSocketController.ts";
import { InsightsController } from "./controllers/InsightsController.ts";
import { ProjectEstateController } from "./controllers/ProjectEstateController.ts";
import { QualityController } from "./controllers/QualityController.ts";
import { SigilAnalyticsController } from "./controllers/SigilAnalyticsController.ts";
import { SigilController } from "./controllers/SigilController.ts";
import { SigilIngestController } from "./controllers/SigilIngestController.ts";
import { BlightJobs } from "./jobs/BlightJobs.ts";
import { DeployJobs } from "./jobs/DeployJobs.ts";
import { EstateCommandJobs } from "./jobs/EstateCommandJobs.ts";
import { EstateCredentialJobs } from "./jobs/EstateCredentialJobs.ts";
import { QualityJobs } from "./jobs/QualityJobs.ts";
import { SigilJobs } from "./jobs/SigilJobs.ts";
import { EstateNotifications } from "./notifications/EstateNotifications.ts";
import { AppSecretService } from "./services/AppSecretService.ts";
import { AppService } from "./services/AppService.ts";
import { ArtifactService } from "./services/ArtifactService.ts";
import { ArtifactTarReader } from "./services/ArtifactTarReader.ts";
import { BlightQuestHandBack } from "./services/BlightQuestHandBack.ts";
import { BlightRuleService } from "./services/BlightRuleService.ts";
import { CloudflareProbeService } from "./services/CloudflareProbeService.ts";
import { CredentialSealService } from "./services/CredentialSealService.ts";
import { DailyVisitorsService } from "./services/DailyVisitorsService.ts";
import { DeployDashboard } from "./services/DeployDashboard.ts";
import { DeployDashboardMetrics } from "./services/DeployDashboardMetrics.ts";
import { DeployGate } from "./services/DeployGate.ts";
import { DeployLimits } from "./services/DeployLimits.ts";
import { DeployProjectCounts } from "./services/DeployProjectCounts.ts";
import { DeployRegistry } from "./services/DeployRegistry.ts";
import { DeployRunner } from "./services/DeployRunner.ts";
import { DeployService } from "./services/DeployService.ts";
import { EstateCloudflareService } from "./services/EstateCloudflareService.ts";
import { EstateCommandService } from "./services/EstateCommandService.ts";
import { EstateCommandTransport } from "./services/EstateCommandTransport.ts";
import { EstateService } from "./services/EstateService.ts";
import { EstateStatsService } from "./services/EstateStatsService.ts";
import { EstateTokenService } from "./services/EstateTokenService.ts";
import { OpenBlightCounter } from "./services/OpenBlightCounter.ts";
import { OpenBlightsMetric } from "./services/OpenBlightsMetric.ts";
import { QualityService } from "./services/QualityService.ts";
import { RollbackService } from "./services/RollbackService.ts";
import { SigilIngestService } from "./services/SigilIngestService.ts";
import { SigilTokenService } from "./services/SigilTokenService.ts";
import { UniqueVisitorsMetric } from "./services/UniqueVisitorsMetric.ts";
import { WebSocketEstateCommandTransport } from "./services/WebSocketEstateCommandTransport.ts";

/**
 * The server half of `@lore/deploy`, Lore as Vercel: apps, telemetry (sigils, analytics, vitals, blights, quality), deployments and estates.
 *
 * It depends on `@lore/core` only: a feature that spans two modules goes through a core registry or a core link, never through an import of another feature module (`check:conventions`).
 *
 * Registered by `apps/lore/src/main.server.ts`, after every entry-level
 * substitution.
 *
 * @module
 */
export const LoreDeployApi = $module({
  name: "lore.deploy.api",
  // Core first: booting this module alone boots what it depends on.
  imports: [
    LoreCoreApi,
    // The estates websocket (epic #20). The first websocket in Lore: on
    // Cloudflare the build derives the Durable Object binding and its
    // migration from the `$websocket` below, and the `workerd` export
    // condition picks the Durable Object provider over the Node one.
    AlephaWebSocket,
    // `$rateLimit` on `EstateController.refreshEstate`. Imported rather than
    // left to the middleware: it injects `ServerRateLimitProvider` at request
    // time, when the container is already locked, so an unregistered module
    // is a 500 on the first click rather than a boot failure.
    AlephaServerRateLimit,
  ],
  services: [
    DeployDashboardMetrics,
    BlightQuestHandBack,
    DeployDashboard,
    DeployProjectCounts,
    BlightJobs,
    SigilJobs,
    QualityJobs,
    EstateCommandJobs,
    EstateCredentialJobs,
    EstateNotifications,
    QualityService,
    ArtifactTarReader,
    ArtifactService,
    // Deploying a stored artifact to an estate (epic #1). `DeployRegistry` is
    // the seam #1201 replaces with the `deployments` table; the runner is what
    // writes through it.
    DeployGate,
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
    BlightRuleService,
    OpenBlightCounter,
    DailyVisitorsService,
    OpenBlightsMetric,
    UniqueVisitorsMetric,
    // The sink half: the token an app presents, and what happens to what it
    // sends. `SigilIngestService` itself holds no repository on any of the
    // aggregate tables — writes go through `LoreAnalyticsStore` (uniques) and
    // the `DeployAnalytics` `$analytics()` datasets (views, vitals). An entity
    // exists, for the migration generator, exactly as long as some
    // `$repository` names it.
    SigilTokenService,
    SigilIngestService,
    // The deploy-destination half: a machine's secret and what an estate is.
    // `EstateTokenService` is deliberately not `SigilTokenService` with a
    // different table, see its doc: the two credentials are one grep apart
    // and mean different things.
    EstateTokenService,
    // A cloudflare token is pasted rather than minted, so it is sealed and
    // replayed rather than hashed and forgotten (#1631). Registered before
    // it has a writer: the sealer exists first, so no plaintext credential
    // is ever written even once.
    CredentialSealService,
    // What Lore does with a pasted Cloudflare token: mask it for a read
    // path, and prove it against the account it names before any row is
    // written (#1629, #1630). The probe underneath is one authenticated GET
    // over `globalThis.fetch`, and the seam every spec substitutes.
    CloudflareProbeService,
    EstateCloudflareService,
    EstateService,
    // The queue behind the connection, and the seam the websocket endpoint
    // fills in. This default transport reaches nothing, which is the correct
    // behaviour of a Lore with no socket wired: commands wait as `pending`
    // for the machine's next connect.
    EstateCommandTransport,
    EstateCommandService,
    EstateStatsService,
    // The real transport, substituted for `EstateCommandTransport` in
    // `main.server.ts`. Listed so DI scanning sees the class.
    WebSocketEstateCommandTransport,
    QualityController,
    ArtifactController,
    AppController,
    AppSecretController,
    SigilController,
    SigilIngestController,
    EstateController,
    ProjectEstateController,
    EstateCommandController,
    EstateSocketController,
    EstatePullController,
    AdminEstateController,
    SigilAnalyticsController,
    InsightsController,
    BlightController,
  ],
});

// ---- re-exports, generated by the extraction (#E75) ----

export { AdminEstateController } from "./controllers/AdminEstateController.ts";
export {
  AppController,
  type AppInstanceResource,
} from "./controllers/AppController.ts";
export { AppSecretController } from "./controllers/AppSecretController.ts";
export { ArtifactController } from "./controllers/ArtifactController.ts";
export { BlightController } from "./controllers/BlightController.ts";
export { DeployController } from "./controllers/DeployController.ts";
export {
  EstateCommandController,
  type EstateCommandListItem,
  type EstateCommandResource,
} from "./controllers/EstateCommandController.ts";
export {
  EstateController,
  type EstateInventoryResource,
  type EstateResource,
  type MintedEstate,
  type OwnedEstateResource,
} from "./controllers/EstateController.ts";
export { EstatePullController } from "./controllers/EstatePullController.ts";
export { EstateSocketController } from "./controllers/EstateSocketController.ts";
export {
  InsightsController,
  type InsightsResource,
} from "./controllers/InsightsController.ts";
export {
  type LentEstateResource,
  type MintedLentEstate,
  ProjectEstateController,
} from "./controllers/ProjectEstateController.ts";
export { QualityController } from "./controllers/QualityController.ts";
export { SigilAnalyticsController } from "./controllers/SigilAnalyticsController.ts";
export {
  type MintedSigil,
  SigilController,
  type SigilResource,
} from "./controllers/SigilController.ts";
export { SigilIngestController } from "./controllers/SigilIngestController.ts";
export { DeployAnalytics } from "./entities/deployAnalytics.ts";
export {
  UNIQUES_COLLAPSED_HASH,
  sigilAnalytics,
} from "./entities/sigilAnalytics.ts";
export { BlightJobs } from "./jobs/BlightJobs.ts";
export { DeployJobs } from "./jobs/DeployJobs.ts";
export { EstateCommandJobs } from "./jobs/EstateCommandJobs.ts";
export { EstateCredentialJobs } from "./jobs/EstateCredentialJobs.ts";
export { QualityJobs } from "./jobs/QualityJobs.ts";
export { SigilJobs } from "./jobs/SigilJobs.ts";
export { EstateNotifications } from "./notifications/EstateNotifications.ts";
export { LoreSigilSinkProvider } from "./providers/LoreSigilSinkProvider.ts";
export { deployRelations } from "./relations/deployRelations.ts";
export { AppSecretService } from "./services/AppSecretService.ts";
export { AppService } from "./services/AppService.ts";
export {
  type ArtifactGrouping,
  type ArtifactImagePushInput,
  type ArtifactKey,
  type ArtifactListing,
  type ArtifactPushInput,
  type ArtifactPushResult,
  type ArtifactQuery,
  ArtifactService,
} from "./services/ArtifactService.ts";
export {
  type ArtifactTarEntry,
  type ArtifactTarExtractOptions,
  ArtifactTarReader,
  type ArtifactTarSink,
} from "./services/ArtifactTarReader.ts";
export { BlightQuestHandBack } from "./services/BlightQuestHandBack.ts";
export { BlightRuleService } from "./services/BlightRuleService.ts";
export {
  type CloudflareProbeResponse,
  CloudflareProbeService,
} from "./services/CloudflareProbeService.ts";
export { CredentialSealService } from "./services/CredentialSealService.ts";
export {
  type DailyVisitors,
  DailyVisitorsService,
} from "./services/DailyVisitorsService.ts";
export { DeployAssetCache } from "./services/DeployAssetCache.ts";
export { DeployDashboard } from "./services/DeployDashboard.ts";
export { DeployDashboardMetrics } from "./services/DeployDashboardMetrics.ts";
export { DeployGate } from "./services/DeployGate.ts";
export { DeployLimits } from "./services/DeployLimits.ts";
export { DeployProjectCounts } from "./services/DeployProjectCounts.ts";
export {
  type DeployLogLine,
  DeployRegistry,
} from "./services/DeployRegistry.ts";
export { type DeployRequest, DeployRunner } from "./services/DeployRunner.ts";
export { DeployService } from "./services/DeployService.ts";
export {
  type CloudflarePermissionProbe,
  EstateCloudflareService,
  type EstateCredentialCheck,
  type EstateCredentialField,
} from "./services/EstateCloudflareService.ts";
export {
  type EstateCommandAck,
  EstateCommandService,
} from "./services/EstateCommandService.ts";
export { EstateCommandTransport } from "./services/EstateCommandTransport.ts";
export { EstateInventoryService } from "./services/EstateInventoryService.ts";
export { EstateService } from "./services/EstateService.ts";
export {
  type EstateStatsPoint,
  type EstateStatsSeries,
  EstateStatsService,
} from "./services/EstateStatsService.ts";
export { EstateTokenService } from "./services/EstateTokenService.ts";
export {
  type ImageDescriptor,
  ImageRegistryClient,
  type ParsedReference,
} from "./services/ImageRegistryClient.ts";
export {
  LoreAnalyticsStore,
  type LoreAnalyticsUniqueSample,
  type LoreAnalyticsWindow,
} from "./services/LoreAnalyticsStore.ts";
export {
  type BlightKey,
  type OpenBlightCount,
  OpenBlightCounter,
  type OpenBlightQuery,
} from "./services/OpenBlightCounter.ts";
export { OpenBlightsMetric } from "./services/OpenBlightsMetric.ts";
export {
  type QualityRunInput,
  QualityService,
} from "./services/QualityService.ts";
export {
  type RegistryRequest,
  RegistryTransport,
} from "./services/RegistryTransport.ts";
export { ResourceNameService } from "./services/ResourceNameService.ts";
export {
  type RollbackPlan,
  RollbackService,
} from "./services/RollbackService.ts";
export {
  type SigilGates,
  SigilIngestService,
} from "./services/SigilIngestService.ts";
export { SigilTokenService } from "./services/SigilTokenService.ts";
export { StoredNamingService } from "./services/StoredNamingService.ts";
export {
  type RecordedResources,
  TeardownService,
} from "./services/TeardownService.ts";
export { UniqueVisitorsMetric } from "./services/UniqueVisitorsMetric.ts";
export { WebSocketEstateCommandTransport } from "./services/WebSocketEstateCommandTransport.ts";
export {
  type AnalyticsVitalHistograms,
  type VitalsSummary,
  summariseVitalMetric,
  summariseVitals,
} from "./vitalsPercentile.ts";
