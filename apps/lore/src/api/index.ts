import { $module } from "alepha";
import { AdminInvitationController } from "./controllers/AdminInvitationController.ts";
import { BlightController } from "./controllers/BlightController.ts";
import { BlobController } from "./controllers/BlobController.ts";
import { CampaignController } from "./controllers/CampaignController.ts";
import { CampaignQuestPortabilityController } from "./controllers/CampaignQuestPortabilityController.ts";
import { CampaignStatsController } from "./controllers/CampaignStatsController.ts";
import { ChapterController } from "./controllers/ChapterController.ts";
import { DirectoryController } from "./controllers/DirectoryController.ts";
import { FolioController } from "./controllers/FolioController.ts";
import { IdentityController } from "./controllers/IdentityController.ts";
import { InsightsController } from "./controllers/InsightsController.ts";
import { InvitationController } from "./controllers/InvitationController.ts";
import { KanbanController } from "./controllers/KanbanController.ts";
import { OutpostCommandController } from "./controllers/OutpostCommandController.ts";
import { OutpostController } from "./controllers/OutpostController.ts";
import { OutpostIngestController } from "./controllers/OutpostIngestController.ts";
import { PetitionController } from "./controllers/PetitionController.ts";
import { QuestController } from "./controllers/QuestController.ts";
import { ReleaseController } from "./controllers/ReleaseController.ts";
import { SessionController } from "./controllers/SessionController.ts";
import { SigilController } from "./controllers/SigilController.ts";
import { SigilIngestController } from "./controllers/SigilIngestController.ts";
import { UserController } from "./controllers/UserController.ts";
import { VersionController } from "./controllers/VersionController.ts";
import { BlightJobs } from "./jobs/BlightJobs.ts";
import { ChapterJobs } from "./jobs/ChapterJobs.ts";
import { InvitationJobs } from "./jobs/InvitationJobs.ts";
import { QuestJobs } from "./jobs/QuestJobs.ts";
import { InvitationNotifications } from "./notifications/InvitationNotifications.ts";
import { QuestNotifications } from "./notifications/QuestNotifications.ts";
import { AppSecurityProvider } from "./providers/AppSecurityProvider.ts";
import { LoreFileAccessProvider } from "./providers/LoreFileAccessProvider.ts";
import { ArchiveBlobService } from "./services/ArchiveBlobService.ts";
import { ArchiveDirectoryService } from "./services/ArchiveDirectoryService.ts";
import { ArchiveNameService } from "./services/ArchiveNameService.ts";
import { BlightRuleService } from "./services/BlightRuleService.ts";
import { CampaignLimits } from "./services/CampaignLimits.ts";
import { CampaignSecurityService } from "./services/CampaignSecurityService.ts";
import { FolioHistoryService } from "./services/FolioHistoryService.ts";
import { FolioLinkService } from "./services/FolioLinkService.ts";
import { InvitationService } from "./services/InvitationService.ts";
import { OutpostIngestService } from "./services/OutpostIngestService.ts";
import { OutpostTokenService } from "./services/OutpostTokenService.ts";
import { PetitionRateLimiter } from "./services/PetitionRateLimiter.ts";
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
    CampaignSecurityService,
    // Substituted for the framework's `FileAccessProvider` in
    // `main.server.ts`. Listed here only so DI scanning sees the class.
    LoreFileAccessProvider,
    ArchiveNameService,
    ArchiveDirectoryService,
    ArchiveBlobService,
    FolioHistoryService,
    FolioLinkService,
    InvitationService,
    InvitationJobs,
    ChapterJobs,
    QuestJobs,
    BlightJobs,
    QuestNotifications,
    InvitationNotifications,
    PetitionRateLimiter,
    QuestCsvParser,
    QuestCsvFormatter,
    AlephaLoreParser,
    TrelloParser,
    QuestImportFormatProvider,
    QuestService,
    CampaignLimits,
    BlightRuleService,
    // The sink half: the token an app presents, and what happens to what it
    // sends. `SigilIngestService` is also the only place the four aggregate
    // tables are declared — an entity exists, for the migration generator,
    // exactly as long as some `$repository` names it.
    SigilTokenService,
    SigilIngestService,
    OutpostTokenService,
    OutpostIngestService,
    ReleaseService,
    // Controllers
    QuestController,
    CampaignController,
    UserController,
    SessionController,
    ChapterController,
    IdentityController,
    CampaignStatsController,
    CampaignQuestPortabilityController,
    InvitationController,
    AdminInvitationController,
    KanbanController,
    FolioController,
    DirectoryController,
    BlobController,
    PetitionController,
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
