import { $module } from "alepha";
import {
  AlephaApiAnalyticsAdmin,
  AlephaApiAnalyticsRollup,
} from "alepha/api/analytics";
import { AdminInvitationController } from "./controllers/AdminInvitationController.ts";
import { AdminProjectController } from "./controllers/AdminProjectController.ts";
import { BlightController } from "./controllers/BlightController.ts";
import { BlobController } from "./controllers/BlobController.ts";
import { DirectoryController } from "./controllers/DirectoryController.ts";
import { EpicController } from "./controllers/EpicController.ts";
import { FeedbackController } from "./controllers/FeedbackController.ts";
import { FolioController } from "./controllers/FolioController.ts";
import { InsightsController } from "./controllers/InsightsController.ts";
import { InvitationController } from "./controllers/InvitationController.ts";
import { KanbanController } from "./controllers/KanbanController.ts";
import { MilestoneController } from "./controllers/MilestoneController.ts";
import { ProjectController } from "./controllers/ProjectController.ts";
import { ProjectQuestPortabilityController } from "./controllers/ProjectQuestPortabilityController.ts";
import { ProjectReportsController } from "./controllers/ProjectReportsController.ts";
import { QuestController } from "./controllers/QuestController.ts";
import { SearchController } from "./controllers/SearchController.ts";
import { SigilController } from "./controllers/SigilController.ts";
import { SigilIngestController } from "./controllers/SigilIngestController.ts";
import { VersionController } from "./controllers/VersionController.ts";
import { UserDeletionHook } from "./hooks/UserDeletionHook.ts";
import { BlightJobs } from "./jobs/BlightJobs.ts";
import { InvitationJobs } from "./jobs/InvitationJobs.ts";
import { MilestoneJobs } from "./jobs/MilestoneJobs.ts";
import { QuestJobs } from "./jobs/QuestJobs.ts";
import { SigilJobs } from "./jobs/SigilJobs.ts";
import { InvitationNotifications } from "./notifications/InvitationNotifications.ts";
import { QuestNotifications } from "./notifications/QuestNotifications.ts";
import { AppSecurityProvider } from "./providers/AppSecurityProvider.ts";
import { LoreFileAccessProvider } from "./providers/LoreFileAccessProvider.ts";
import { AreaService } from "./services/AreaService.ts";
import { BlightRuleService } from "./services/BlightRuleService.ts";
import { FeedbackRateLimiter } from "./services/FeedbackRateLimiter.ts";
import { FolioBlobService } from "./services/FolioBlobService.ts";
import { FolioDirectoryService } from "./services/FolioDirectoryService.ts";
import { FolioHistoryService } from "./services/FolioHistoryService.ts";
import { FolioLinkService } from "./services/FolioLinkService.ts";
import { FolioNameService } from "./services/FolioNameService.ts";
import { FrozenSigilAnalyticsTables } from "./services/FrozenSigilAnalyticsTables.ts";
import { InvitationService } from "./services/InvitationService.ts";
import { ProjectLimits } from "./services/ProjectLimits.ts";
import { ProjectSecurityService } from "./services/ProjectSecurityService.ts";
import { AlephaLoreParser } from "./services/parsers/AlephaLoreParser.ts";
import { TrelloParser } from "./services/parsers/TrelloParser.ts";
import { QuestCsvFormatter } from "./services/QuestCsvFormatter.ts";
import { QuestCsvParser } from "./services/QuestCsvParser.ts";
import { QuestImportFormatProvider } from "./services/QuestImportFormatProvider.ts";
import { QuestService } from "./services/QuestService.ts";
import { SigilIngestService } from "./services/SigilIngestService.ts";
import { SigilTokenService } from "./services/SigilTokenService.ts";

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
  imports: [AlephaApiAnalyticsRollup, AlephaApiAnalyticsAdmin],
  services: [
    // Declares the `$realm`. Nothing injects it — it must be listed here
    // explicitly or the realm (and every permission) is never registered.
    AppSecurityProvider,
    ProjectSecurityService,
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
    MilestoneJobs,
    QuestJobs,
    BlightJobs,
    SigilJobs,
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
    ProjectLimits,
    AreaService,
    BlightRuleService,
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
    ProjectController,
    MilestoneController,
    EpicController,
    ProjectReportsController,
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
    VersionController,
  ],
});
