import { $module } from "alepha";
import {
  AlephaApiAnalyticsAdmin,
  AlephaApiAnalyticsRollup,
} from "alepha/api/analytics";

import { AdminInvitationController } from "./controllers/AdminInvitationController.ts";
import { AdminProjectController } from "./controllers/AdminProjectController.ts";
import { AreaController } from "./controllers/AreaController.ts";
import { BlightController } from "./controllers/BlightController.ts";
import { BlobController } from "./controllers/BlobController.ts";
import { DashboardController } from "./controllers/DashboardController.ts";
import { DirectoryController } from "./controllers/DirectoryController.ts";
import { EpicController } from "./controllers/EpicController.ts";
import { FeedbackCommentController } from "./controllers/FeedbackCommentController.ts";
import { FeedbackController } from "./controllers/FeedbackController.ts";
import { FolioController } from "./controllers/FolioController.ts";
import { InsightsController } from "./controllers/InsightsController.ts";
import { InvitationController } from "./controllers/InvitationController.ts";
import { KanbanController } from "./controllers/KanbanController.ts";
import { ProjectController } from "./controllers/ProjectController.ts";
import { ProjectQuestPortabilityController } from "./controllers/ProjectQuestPortabilityController.ts";
import { ProjectReportsController } from "./controllers/ProjectReportsController.ts";
import { QualityController } from "./controllers/QualityController.ts";
import { QuestCommentController } from "./controllers/QuestCommentController.ts";
import { QuestController } from "./controllers/QuestController.ts";
import { ReleaseController } from "./controllers/ReleaseController.ts";
import { RoadmapController } from "./controllers/RoadmapController.ts";
import { SearchController } from "./controllers/SearchController.ts";
import { SigilController } from "./controllers/SigilController.ts";
import { SigilIngestController } from "./controllers/SigilIngestController.ts";
import { LoreDashboardCatalog } from "./dashboardCatalogModule.ts";
import { UserDeletionHook } from "./hooks/UserDeletionHook.ts";
import { BlightJobs } from "./jobs/BlightJobs.ts";
import { InvitationJobs } from "./jobs/InvitationJobs.ts";
import { QualityJobs } from "./jobs/QualityJobs.ts";
import { QuestJobs } from "./jobs/QuestJobs.ts";
import { SigilJobs } from "./jobs/SigilJobs.ts";
import { InvitationNotifications } from "./notifications/InvitationNotifications.ts";
import { QuestNotifications } from "./notifications/QuestNotifications.ts";
import { AppSecurityProvider } from "./providers/AppSecurityProvider.ts";
import { LoreFileAccessProvider } from "./providers/LoreFileAccessProvider.ts";
import { ActiveQuestsMetric } from "./services/ActiveQuestsMetric.ts";
import { AreaService } from "./services/AreaService.ts";
import { BlightRuleService } from "./services/BlightRuleService.ts";
import { DailyVisitorsService } from "./services/DailyVisitorsService.ts";
import { DashboardCardService } from "./services/DashboardCardService.ts";
import { DashboardMetricRegistry } from "./services/DashboardMetricRegistry.ts";
import { DashboardScopeService } from "./services/DashboardScopeService.ts";
import { FeedbackRateLimiter } from "./services/FeedbackRateLimiter.ts";
import { FolioBlobService } from "./services/FolioBlobService.ts";
import { FolioDirectoryService } from "./services/FolioDirectoryService.ts";
import { FolioHistoryService } from "./services/FolioHistoryService.ts";
import { FolioLinkService } from "./services/FolioLinkService.ts";
import { FolioNameService } from "./services/FolioNameService.ts";
import { FrozenSigilAnalyticsTables } from "./services/FrozenSigilAnalyticsTables.ts";
import { InvitationService } from "./services/InvitationService.ts";
import { OpenBlightCounter } from "./services/OpenBlightCounter.ts";
import { OpenBlightsMetric } from "./services/OpenBlightsMetric.ts";
import { OpenQuestScope } from "./services/OpenQuestScope.ts";
import { AlephaLoreParser } from "./services/parsers/AlephaLoreParser.ts";
import { TrelloParser } from "./services/parsers/TrelloParser.ts";
import { ProjectActivityService } from "./services/ProjectActivityService.ts";
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
  imports: [
    AlephaApiAnalyticsRollup,
    AlephaApiAnalyticsAdmin,
    LoreDashboardCatalog,
  ],
  services: [
    // Declares the `$realm`. Nothing injects it — it must be listed here
    // explicitly or the realm (and every permission) is never registered.
    AppSecurityProvider,
    ProjectSecurityService,
    ReleaseAttachmentService,
    ReleaseContentService,
    RoadmapService,
    // Substituted for the framework's `FileAccessProvider` in
    // `main.server.ts`. Listed here only so DI scanning sees the class.
    LoreFileAccessProvider,
    // Pins `sigil_views_hourly` / `sigil_vitals_hourly` in the migration
    // snapshot now that nothing else holds a repository on either — see its
    // own doc for why that would otherwise read as a dropped table.
    FrozenSigilAnalyticsTables,
    FolioNameService,
    FolioDirectoryService,
    FolioBlobService,
    FolioHistoryService,
    FolioLinkService,
    InvitationService,
    InvitationJobs,
    QuestJobs,
    BlightJobs,
    SigilJobs,
    QualityJobs,
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
    ProjectLimits,
    AreaService,
    ProjectActivityService,
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
    ProjectQuestPortabilityController,
    InvitationController,
    AdminInvitationController,
    AdminProjectController,
    KanbanController,
    FolioController,
    DirectoryController,
    SearchController,
    BlobController,
    FeedbackController,
    SigilController,
    SigilIngestController,
    InsightsController,
    BlightController,
    DashboardController,
  ],
});
