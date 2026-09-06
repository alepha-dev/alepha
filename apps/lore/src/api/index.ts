import { $module } from "alepha";
import {
  AlephaApiAnalyticsAdmin,
  AlephaApiAnalyticsRollup,
} from "alepha/api/analytics";
import { AlephaApiInvitations } from "alepha/api/invitations";
import { AlephaWebSocket } from "alepha/websocket";

import { AdminEstateController } from "./controllers/AdminEstateController.ts";
import { AdminProjectController } from "./controllers/AdminProjectController.ts";
import { AppController } from "./controllers/AppController.ts";
import { AreaController } from "./controllers/AreaController.ts";
import { ArtifactController } from "./controllers/ArtifactController.ts";
import { BlightController } from "./controllers/BlightController.ts";
import { DashboardController } from "./controllers/DashboardController.ts";
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
import { InvitationController } from "./controllers/InvitationController.ts";
import { KanbanController } from "./controllers/KanbanController.ts";
import { ProjectController } from "./controllers/ProjectController.ts";
import { ProjectEstateController } from "./controllers/ProjectEstateController.ts";
import { ProjectQuestPortabilityController } from "./controllers/ProjectQuestPortabilityController.ts";
import { ProjectReportsController } from "./controllers/ProjectReportsController.ts";
import { QualityController } from "./controllers/QualityController.ts";
import { QuestCommentController } from "./controllers/QuestCommentController.ts";
import { QuestController } from "./controllers/QuestController.ts";
import { ReleaseController } from "./controllers/ReleaseController.ts";
import { RoadmapController } from "./controllers/RoadmapController.ts";
import { SearchController } from "./controllers/SearchController.ts";
import { SigilAnalyticsController } from "./controllers/SigilAnalyticsController.ts";
import { SigilController } from "./controllers/SigilController.ts";
import { SigilIngestController } from "./controllers/SigilIngestController.ts";
import { LoreDashboardCatalog } from "./dashboardCatalogModule.ts";
import { UserDeletionHook } from "./hooks/UserDeletionHook.ts";
import { BlightJobs } from "./jobs/BlightJobs.ts";
import { EstateCommandJobs } from "./jobs/EstateCommandJobs.ts";
import { QualityJobs } from "./jobs/QualityJobs.ts";
import { QuestJobs } from "./jobs/QuestJobs.ts";
import { SigilJobs } from "./jobs/SigilJobs.ts";
import { InvitationNotifications } from "./notifications/InvitationNotifications.ts";
import { QuestNotifications } from "./notifications/QuestNotifications.ts";
import { AppSecurityProvider } from "./providers/AppSecurityProvider.ts";
import { LoreFileAccessProvider } from "./providers/LoreFileAccessProvider.ts";
import { ProjectInvitationResource } from "./providers/ProjectInvitationResource.ts";
import { ActiveQuestsMetric } from "./services/ActiveQuestsMetric.ts";
import { AppService } from "./services/AppService.ts";
import { AreaService } from "./services/AreaService.ts";
import { ArtifactService } from "./services/ArtifactService.ts";
import { ArtifactTarReader } from "./services/ArtifactTarReader.ts";
import { BlightRuleService } from "./services/BlightRuleService.ts";
import { CredentialSealService } from "./services/CredentialSealService.ts";
import { DailyVisitorsService } from "./services/DailyVisitorsService.ts";
import { DashboardCardService } from "./services/DashboardCardService.ts";
import { DashboardMetricRegistry } from "./services/DashboardMetricRegistry.ts";
import { DashboardScopeService } from "./services/DashboardScopeService.ts";
import { EpicDependencyService } from "./services/EpicDependencyService.ts";
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
import { FolioLinkService } from "./services/FolioLinkService.ts";
import { FolioNameService } from "./services/FolioNameService.ts";
import { FrozenSigilAnalyticsTables } from "./services/FrozenSigilAnalyticsTables.ts";
import { LoreAudits } from "./services/LoreAudits.ts";
import { OpenBlightCounter } from "./services/OpenBlightCounter.ts";
import { OpenBlightsMetric } from "./services/OpenBlightsMetric.ts";
import { OpenQuestScope } from "./services/OpenQuestScope.ts";
import { AlephaLoreParser } from "./services/parsers/AlephaLoreParser.ts";
import { TrelloParser } from "./services/parsers/TrelloParser.ts";
import { ProjectLimits } from "./services/ProjectLimits.ts";
import { ProjectSecurityService } from "./services/ProjectSecurityService.ts";
import { QualityService } from "./services/QualityService.ts";
import { QuestCsvFormatter } from "./services/QuestCsvFormatter.ts";
import { QuestCsvParser } from "./services/QuestCsvParser.ts";
import { QuestImportFormatProvider } from "./services/QuestImportFormatProvider.ts";
import { QuestService } from "./services/QuestService.ts";
import { ReleaseAttachmentService } from "./services/ReleaseAttachmentService.ts";
import { ReleaseContentService } from "./services/ReleaseContentService.ts";
import { RoadmapService } from "./services/RoadmapService.ts";
import { SigilIngestService } from "./services/SigilIngestService.ts";
import { SigilTokenService } from "./services/SigilTokenService.ts";
import { UniqueVisitorsMetric } from "./services/UniqueVisitorsMetric.ts";
import { UntriagedFeedbackMetric } from "./services/UntriagedFeedbackMetric.ts";
import { WebSocketEstateCommandTransport } from "./services/WebSocketEstateCommandTransport.ts";

export const LoreApi = $module({
  name: "lore.api",
  // `$analytics()` (used by `LoreAnalytics`) auto-wires `AlephaApiAnalytics`
  // itself the moment a dataset is injected — the same module-tagging
  // mechanism `$repository` uses for `AlephaOrm`. The hourly retention sweep
  // does not: `AnalyticsRollupJobs` lives in the separate `AlephaApiAnalyticsRollup`
  // module specifically so declaring a dataset never forces a database
  // connection onto an app that has none. Both `sigil_views` and
  // `sigil_vitals` declare `retention.hot`, so this import is required, not
  // optional — without it the sweep never runs and the raw tables grow
  // forever with no error (see `AnalyticsRetentionGuard`'s boot warning).
  // `AlephaApiAnalyticsAdmin` is the opt-in admin query surface behind
  // `admin:analytics:read` — it feeds the /admin/analytics page.
  //
  // `AlephaApiInvitations` brings the invitation lifecycle, its hourly expiry
  // and purge jobs, and the `admin:invitation:*` surface. What a project IS
  // stays here, in `ProjectInvitationResource`.
  imports: [
    AlephaApiAnalyticsRollup,
    AlephaApiAnalyticsAdmin,
    AlephaApiInvitations,
    LoreDashboardCatalog,
    // The estates websocket (epic #20). The first websocket in Lore: on
    // Cloudflare the build derives the Durable Object binding and its
    // migration from the `$websocket` below, and the `workerd` export
    // condition picks the Durable Object provider over the Node one.
    AlephaWebSocket,
  ],
  services: [
    // Declares the `$realm`. Nothing injects it — it must be listed here
    // explicitly or the realm (and every permission) is never registered.
    AppSecurityProvider,
    // Declares the $audit types. Nothing but the controllers inject it, and
    // they inject it lazily - listed here so the types are registered at
    // boot and the admin filter offers them before any row exists.
    LoreAudits,
    ProjectSecurityService,
    ReleaseAttachmentService,
    ReleaseContentService,
    RoadmapService,
    EpicDependencyService,
    // The one place the epic workflow's refusals are written (epic #31):
    // which quest action is allowed in which epic phase, and the words a
    // refusal carries. Injected by the quest and epic controllers.
    EpicWorkflowService,
    // Substituted for the framework's `FileAccessProvider` in
    // `main.server.ts`. Listed here only so DI scanning sees the class.
    LoreFileAccessProvider,
    // Pins `sigil_views_hourly` / `sigil_vitals_hourly` in the migration
    // snapshot now that nothing else holds a repository on either — see its
    // own doc for why that would otherwise read as a dropped table.
    FrozenSigilAnalyticsTables,
    FolioNameService,
    FolioDirectoryService,
    FolioAttachmentService,
    FolioHistoryService,
    FolioLinkService,
    // Declares the `$invitationResource` for `resourceType: "project"`.
    // Nothing injects it, so like `AppSecurityProvider` it has to be listed
    // or the resolver is never registered and every invitation 404s.
    ProjectInvitationResource,
    QuestJobs,
    BlightJobs,
    SigilJobs,
    QualityJobs,
    EstateCommandJobs,
    UserDeletionHook,
    QuestNotifications,
    InvitationNotifications,
    FeedbackRateLimiter,
    QuestCsvParser,
    QuestCsvFormatter,
    AlephaLoreParser,
    TrelloParser,
    QuestImportFormatProvider,
    QuestService,
    QualityService,
    ArtifactTarReader,
    ArtifactService,
    ProjectLimits,
    AreaService,
    // The one write path for `app_instances`, and the only writer of
    // `sigils.name`, which mirrors it (#1767).
    AppService,
    BlightRuleService,
    OpenBlightCounter,
    // What "open quests" means, shared by the sidebar badge, the dashboard
    // rail and the Active Quests tile — all three are visible together.
    OpenQuestScope,
    // The dashboard: the membership gate every card scope goes through, and
    // card storage. The declarative registry itself lives in
    // `LoreDashboardCatalog` — see that module for why it cannot be listed
    // here as well as in `LoreWebApp`.
    DashboardScopeService,
    DashboardCardService,
    DailyVisitorsService,
    // One resolver per metric, plus the registry that groups a card list by
    // metric so N cards on one metric stay one query.
    ActiveQuestsMetric,
    OpenBlightsMetric,
    UntriagedFeedbackMetric,
    UniqueVisitorsMetric,
    DashboardMetricRegistry,
    // The sink half: the token an app presents, and what happens to what it
    // sends. `SigilIngestService` itself holds no repository on any of the
    // aggregate tables — writes go through `LoreAnalyticsStore` (uniques) and
    // the `LoreAnalytics` `$analytics()` datasets (views, vitals). An entity
    // exists, for the migration generator, exactly as long as some
    // `$repository` — or, for the two frozen legacy tables,
    // `FrozenSigilAnalyticsTables` above — names it.
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
    // written (#1629, #1630).
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
    ProjectController,
    ReleaseController,
    RoadmapController,
    EpicController,
    AreaController,
    ProjectReportsController,
    QualityController,
    ArtifactController,
    ProjectQuestPortabilityController,
    InvitationController,
    AdminProjectController,
    KanbanController,
    FolioController,
    DirectoryController,
    SearchController,
    FolioAttachmentController,
    FeedbackController,
    AppController,
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
    DashboardController,
  ],
});
