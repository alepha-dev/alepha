import { $module } from "alepha";
import { AdminInvitationController } from "./controllers/AdminInvitationController.ts";
import { BlightController } from "./controllers/BlightController.ts";
import { BlobController } from "./controllers/BlobController.ts";
import { DirectoryController } from "./controllers/DirectoryController.ts";
import { FeedbackController } from "./controllers/FeedbackController.ts";
import { FolioController } from "./controllers/FolioController.ts";
import { IdentityController } from "./controllers/IdentityController.ts";
import { InsightsController } from "./controllers/InsightsController.ts";
import { InvitationController } from "./controllers/InvitationController.ts";
import { KanbanController } from "./controllers/KanbanController.ts";
import { MilestoneController } from "./controllers/MilestoneController.ts";
import { OutpostCommandController } from "./controllers/OutpostCommandController.ts";
import { OutpostController } from "./controllers/OutpostController.ts";
import { OutpostIngestController } from "./controllers/OutpostIngestController.ts";
import { ProjectController } from "./controllers/ProjectController.ts";
import { ProjectQuestPortabilityController } from "./controllers/ProjectQuestPortabilityController.ts";
import { ProjectReportsController } from "./controllers/ProjectReportsController.ts";
import { QuestController } from "./controllers/QuestController.ts";
import { ReleaseController } from "./controllers/ReleaseController.ts";
import { SessionController } from "./controllers/SessionController.ts";
import { SigilController } from "./controllers/SigilController.ts";
import { SigilIngestController } from "./controllers/SigilIngestController.ts";
import { UserController } from "./controllers/UserController.ts";
import { VersionController } from "./controllers/VersionController.ts";
import { BlightJobs } from "./jobs/BlightJobs.ts";
import { InvitationJobs } from "./jobs/InvitationJobs.ts";
import { MilestoneJobs } from "./jobs/MilestoneJobs.ts";
import { QuestJobs } from "./jobs/QuestJobs.ts";
import { InvitationNotifications } from "./notifications/InvitationNotifications.ts";
import { QuestNotifications } from "./notifications/QuestNotifications.ts";
import { AppSecurityProvider } from "./providers/AppSecurityProvider.ts";
import { LoreFileAccessProvider } from "./providers/LoreFileAccessProvider.ts";
import { ArtifactService } from "./services/ArtifactService.ts";
import { BlightRuleService } from "./services/BlightRuleService.ts";
import { FeedbackRateLimiter } from "./services/FeedbackRateLimiter.ts";
import { FolioBlobService } from "./services/FolioBlobService.ts";
import { FolioDirectoryService } from "./services/FolioDirectoryService.ts";
import { FolioHistoryService } from "./services/FolioHistoryService.ts";
import { FolioLinkService } from "./services/FolioLinkService.ts";
import { FolioNameService } from "./services/FolioNameService.ts";
import { InvitationService } from "./services/InvitationService.ts";
import { OutpostIngestService } from "./services/OutpostIngestService.ts";
import { OutpostTokenService } from "./services/OutpostTokenService.ts";
import { ProjectLimits } from "./services/ProjectLimits.ts";
import { ProjectSecurityService } from "./services/ProjectSecurityService.ts";
import { AlephaLoreParser } from "./services/parsers/AlephaLoreParser.ts";
import { TrelloParser } from "./services/parsers/TrelloParser.ts";
import { QuestCsvFormatter } from "./services/QuestCsvFormatter.ts";
import { QuestCsvParser } from "./services/QuestCsvParser.ts";
import { QuestImportFormatProvider } from "./services/QuestImportFormatProvider.ts";
import { QuestService } from "./services/QuestService.ts";
import { ReleaseService } from "./services/ReleaseService.ts";
import { SigilIngestService } from "./services/SigilIngestService.ts";
import { SigilTokenService } from "./services/SigilTokenService.ts";

export const LoreApi = $module({
  name: "lore.api",
  services: [
    // Declares the `$realm`. Nothing injects it — it must be listed here
    // explicitly or the realm (and every permission) is never registered.
    AppSecurityProvider,
    ProjectSecurityService,
    // Substituted for the framework's `FileAccessProvider` in
    // `main.server.ts`. Listed here only so DI scanning sees the class.
    LoreFileAccessProvider,
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
    BlightRuleService,
    // The sink half: the token an app presents, and what happens to what it
    // sends. `SigilIngestService` is also the only place the four aggregate
    // tables are declared — an entity exists, for the migration generator,
    // exactly as long as some `$repository` names it.
    SigilTokenService,
    SigilIngestService,
    OutpostTokenService,
    OutpostIngestService,
    ArtifactService,
    ReleaseService,
    // Controllers
    QuestController,
    ProjectController,
    UserController,
    SessionController,
    MilestoneController,
    IdentityController,
    ProjectReportsController,
    ProjectQuestPortabilityController,
    InvitationController,
    AdminInvitationController,
    KanbanController,
    FolioController,
    DirectoryController,
    BlobController,
    FeedbackController,
    OutpostController,
    OutpostIngestController,
    OutpostCommandController,
    ReleaseController,
    SigilController,
    SigilIngestController,
    InsightsController,
    BlightController,
    VersionController,
  ],
});
