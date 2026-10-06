import { $module } from "alepha";
import { AlephaServerRateLimit } from "alepha/server/rate-limit";
import { AlephaWebSocket } from "alepha/websocket";

import { AdminEstateController } from "./controllers/AdminEstateController.ts";
import { AppController } from "./controllers/AppController.ts";
import { AppSecretController } from "./controllers/AppSecretController.ts";
import { AreaController } from "./controllers/AreaController.ts";
import { ArtifactController } from "./controllers/ArtifactController.ts";
import { BlightController } from "./controllers/BlightController.ts";
import { DeployController } from "./controllers/DeployController.ts";
import { DirectoryController } from "./controllers/DirectoryController.ts";
import { EpicController } from "./controllers/EpicController.ts";
import { EstateCommandController } from "./controllers/EstateCommandController.ts";
import { EstateController } from "./controllers/EstateController.ts";
import { EstatePullController } from "./controllers/EstatePullController.ts";
import { EstateSocketController } from "./controllers/EstateSocketController.ts";
import { FeedbackCommentController } from "./controllers/FeedbackCommentController.ts";
import { FeedbackController } from "./controllers/FeedbackController.ts";
import { FolioAttachmentController } from "./controllers/FolioAttachmentController.ts";
import { FolioController } from "./controllers/FolioController.ts";
import { InsightsController } from "./controllers/InsightsController.ts";
import { KanbanController } from "./controllers/KanbanController.ts";
import { ProjectEstateController } from "./controllers/ProjectEstateController.ts";
import { ProjectQuestPortabilityController } from "./controllers/ProjectQuestPortabilityController.ts";
import { ProjectReportsController } from "./controllers/ProjectReportsController.ts";
import { QualityController } from "./controllers/QualityController.ts";
import { QuestAuthorshipController } from "./controllers/QuestAuthorshipController.ts";
import { QuestCommentController } from "./controllers/QuestCommentController.ts";
import { QuestController } from "./controllers/QuestController.ts";
import { ReleaseController } from "./controllers/ReleaseController.ts";
import { RoadmapController } from "./controllers/RoadmapController.ts";
import { SigilAnalyticsController } from "./controllers/SigilAnalyticsController.ts";
import { SigilController } from "./controllers/SigilController.ts";
import { SigilIngestController } from "./controllers/SigilIngestController.ts";
import { LoreDashboardCatalog } from "./dashboardCatalogModule.ts";
import { QuestMemberRemoval } from "./hooks/QuestMemberRemoval.ts";
import { BlightJobs } from "./jobs/BlightJobs.ts";
import { DeployJobs } from "./jobs/DeployJobs.ts";
import { EpicJobs } from "./jobs/EpicJobs.ts";
import { EstateCommandJobs } from "./jobs/EstateCommandJobs.ts";
import { EstateCredentialJobs } from "./jobs/EstateCredentialJobs.ts";
import { QualityJobs } from "./jobs/QualityJobs.ts";
import { QuestJobs } from "./jobs/QuestJobs.ts";
import { SigilJobs } from "./jobs/SigilJobs.ts";
import { EstateNotifications } from "./notifications/EstateNotifications.ts";
import { QuestNotifications } from "./notifications/QuestNotifications.ts";
import { DirectoryResourceKind } from "./resources/DirectoryResourceKind.ts";
import { EpicResourceKind } from "./resources/EpicResourceKind.ts";
import { FeedbackResourceKind } from "./resources/FeedbackResourceKind.ts";
import { FolioResourceKind } from "./resources/FolioResourceKind.ts";
import { QuestResourceKind } from "./resources/QuestResourceKind.ts";
import { ReleaseResourceKind } from "./resources/ReleaseResourceKind.ts";
import { ActiveQuestsMetric } from "./services/ActiveQuestsMetric.ts";
import { AppSecretService } from "./services/AppSecretService.ts";
import { AppService } from "./services/AppService.ts";
import { AreaService } from "./services/AreaService.ts";
import { ArtifactService } from "./services/ArtifactService.ts";
import { ArtifactTarReader } from "./services/ArtifactTarReader.ts";
import { BlightQuestHandBack } from "./services/BlightQuestHandBack.ts";
import { BlightRuleService } from "./services/BlightRuleService.ts";
import { CloudflareProbeService } from "./services/CloudflareProbeService.ts";
import { CredentialSealService } from "./services/CredentialSealService.ts";
import { DailyVisitorsService } from "./services/DailyVisitorsService.ts";
import { DeployDashboard } from "./services/DeployDashboard.ts";
import { DeployGate } from "./services/DeployGate.ts";
import { DeployLimits } from "./services/DeployLimits.ts";
import { DeployProjectCounts } from "./services/DeployProjectCounts.ts";
import { DeployRegistry } from "./services/DeployRegistry.ts";
import { DeployRunner } from "./services/DeployRunner.ts";
import { DeployService } from "./services/DeployService.ts";
import { EpicDependencyService } from "./services/EpicDependencyService.ts";
import { EpicProgressMetric } from "./services/EpicProgressMetric.ts";
import { EpicProgressService } from "./services/EpicProgressService.ts";
import { EpicWorkflowService } from "./services/EpicWorkflowService.ts";
import { EstateCloudflareService } from "./services/EstateCloudflareService.ts";
import { EstateCommandService } from "./services/EstateCommandService.ts";
import { EstateCommandTransport } from "./services/EstateCommandTransport.ts";
import { EstateService } from "./services/EstateService.ts";
import { EstateStatsService } from "./services/EstateStatsService.ts";
import { EstateTokenService } from "./services/EstateTokenService.ts";
import { FeedbackRateLimiter } from "./services/FeedbackRateLimiter.ts";
import { FolioAttachmentService } from "./services/FolioAttachmentService.ts";
import { FolioDirectoryService } from "./services/FolioDirectoryService.ts";
import { FolioHistoryService } from "./services/FolioHistoryService.ts";
import { FolioNameService } from "./services/FolioNameService.ts";
import { HeldQuestsMetric } from "./services/HeldQuestsMetric.ts";
import { KnowledgeFileAccess } from "./services/KnowledgeFileAccess.ts";
import { MentionNotifier } from "./services/MentionNotifier.ts";
import { OpenBlightCounter } from "./services/OpenBlightCounter.ts";
import { OpenBlightsMetric } from "./services/OpenBlightsMetric.ts";
import { OpenQuestScope } from "./services/OpenQuestScope.ts";
import { QualityService } from "./services/QualityService.ts";
import { QuestCsvFormatter } from "./services/QuestCsvFormatter.ts";
import { QuestProjectDeletion } from "./services/QuestProjectDeletion.ts";
import { QuestService } from "./services/QuestService.ts";
import { QuestTagTallyService } from "./services/QuestTagTallyService.ts";
import { ReleaseAttachmentService } from "./services/ReleaseAttachmentService.ts";
import { ReleaseContentService } from "./services/ReleaseContentService.ts";
import { ReleaseNotifier } from "./services/ReleaseNotifier.ts";
import { ReleaseProgressMetric } from "./services/ReleaseProgressMetric.ts";
import { RoadmapService } from "./services/RoadmapService.ts";
import { RollbackService } from "./services/RollbackService.ts";
import { SigilIngestService } from "./services/SigilIngestService.ts";
import { SigilTokenService } from "./services/SigilTokenService.ts";
import { TagCompletionMetric } from "./services/TagCompletionMetric.ts";
import { UniqueVisitorsMetric } from "./services/UniqueVisitorsMetric.ts";
import { UntriagedFeedbackMetric } from "./services/UntriagedFeedbackMetric.ts";
import { WebSocketEstateCommandTransport } from "./services/WebSocketEstateCommandTransport.ts";
import { WorkAssignedWork } from "./services/WorkAssignedWork.ts";
import { WorkDashboard } from "./services/WorkDashboard.ts";
import { WorkFileAccess } from "./services/WorkFileAccess.ts";
import { WorkProjectCounts } from "./services/WorkProjectCounts.ts";

export const LoreApi = $module({
  name: "lore.api",
  imports: [
    LoreDashboardCatalog,
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
    ReleaseAttachmentService,
    ReleaseContentService,
    RoadmapService,
    EpicDependencyService,
    // The epic rollup, on a service rather than on the controller now that
    // five surfaces read it: the Epics list, `epic_list`, `project_context`,
    // MCP output and the dashboard's epic card.
    EpicProgressService,
    // The one place the epic workflow's refusals are written (epic #31):
    // which quest action is allowed in which epic phase, and the words a
    // refusal carries. Injected by the quest and epic controllers.
    EpicWorkflowService,
    FolioNameService,
    FolioDirectoryService,
    FolioAttachmentService,
    FolioHistoryService,
    // The resource kinds each module registers on the core
    // `ResourceRegistry` (#E75, #Q2610), and Deploy's subscription to a
    // quest's deletion. Listed, because nothing injects them: a kind exists
    // only once its class is constructed.
    QuestResourceKind,
    EpicResourceKind,
    ReleaseResourceKind,
    FeedbackResourceKind,
    FolioResourceKind,
    DirectoryResourceKind,
    BlightQuestHandBack,
    // Per-project counts each module registers on the core
    // `ProjectCountRegistry` (#Q2623); listed because nothing injects them.
    WorkProjectCounts,
    WorkAssignedWork,
    // Each module's part of the dashboard: scopes, default cards, and the
    // metric resolvers, which register themselves (#Q2623).
    WorkDashboard,
    // Who may read each module's attachment bucket (#Q2623).
    WorkFileAccess,
    // Work's parts of a member leaving and a project going (#Q2623).
    QuestMemberRemoval,
    QuestProjectDeletion,
    QuestAuthorshipController,
    KnowledgeFileAccess,
    DeployDashboard,
    DeployProjectCounts,
    QuestJobs,
    EpicJobs,
    BlightJobs,
    SigilJobs,
    QualityJobs,
    EstateCommandJobs,
    EstateCredentialJobs,
    QuestNotifications,
    EstateNotifications,
    // Turns `@name` in a comment into a message. Injected by the quest and
    // feedback comment controllers.
    MentionNotifier,
    // The release fan-out. Publish only; reopen notifies nobody.
    ReleaseNotifier,
    FeedbackRateLimiter,
    QuestCsvFormatter,
    QuestService,
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
    AreaService,
    // The one write path for `app_instances`, and the only writer of
    // `sigils.name`, which mirrors it (#1767).
    AppService,
    // One deployed copy's environment (#1813). Sealed at rest, opened only by
    // the deploy, and never read back by any endpoint.
    AppSecretService,
    BlightRuleService,
    OpenBlightCounter,
    // What "open quests" means, shared by the sidebar badge, the dashboard
    // rail and the Active Quests tile — all three are visible together.
    OpenQuestScope,
    DailyVisitorsService,
    // One resolver per metric, plus the registry that groups a card list by
    // metric so N cards on one metric stay one query.
    ActiveQuestsMetric,
    HeldQuestsMetric,
    EpicProgressMetric,
    ReleaseProgressMetric,
    TagCompletionMetric,
    OpenBlightsMetric,
    // The per-tag fold, shared by Reports > Quests and the tag card. No
    // `GROUP BY` reaches inside a JSON array in a text column, so there is
    // one in-memory tally and it lives here.
    QuestTagTallyService,
    UntriagedFeedbackMetric,
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
    // Controllers
    QuestController,
    QuestCommentController,
    FeedbackCommentController,
    ReleaseController,
    RoadmapController,
    EpicController,
    AreaController,
    ProjectReportsController,
    QualityController,
    ArtifactController,
    ProjectQuestPortabilityController,
    KanbanController,
    FolioController,
    DirectoryController,
    FolioAttachmentController,
    FeedbackController,
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
