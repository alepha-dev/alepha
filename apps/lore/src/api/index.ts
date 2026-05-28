import { $module } from "alepha";
import { AlephaServerCors } from "alepha/server/cors";
import { AdminInvitationController } from "./controllers/AdminInvitationController.ts";
import { BlightController } from "./controllers/BlightController.ts";
import { BlobController } from "./controllers/BlobController.ts";
import { CampaignController } from "./controllers/CampaignController.ts";
import { CampaignQuestPortabilityController } from "./controllers/CampaignQuestPortabilityController.ts";
import { CampaignStatsController } from "./controllers/CampaignStatsController.ts";
import { ChapterController } from "./controllers/ChapterController.ts";
import { CharacterController } from "./controllers/CharacterController.ts";
import { DirectoryController } from "./controllers/DirectoryController.ts";
import { FeaturePaywallController } from "./controllers/FeaturePaywallController.ts";
import { FolioController } from "./controllers/FolioController.ts";
import { IdentityController } from "./controllers/IdentityController.ts";
import { InsightsController } from "./controllers/InsightsController.ts";
import { InvitationController } from "./controllers/InvitationController.ts";
import { KanbanController } from "./controllers/KanbanController.ts";
import { PetitionController } from "./controllers/PetitionController.ts";
import { QuestController } from "./controllers/QuestController.ts";
import { SessionController } from "./controllers/SessionController.ts";
import { SigilController } from "./controllers/SigilController.ts";
import { SigilEmbedController } from "./controllers/SigilEmbedController.ts";
import { UserController } from "./controllers/UserController.ts";
import { VersionController } from "./controllers/VersionController.ts";
import { ChapterJobs } from "./jobs/ChapterJobs.ts";
import { InvitationJobs } from "./jobs/InvitationJobs.ts";
import { QuestJobs } from "./jobs/QuestJobs.ts";
import { SigilJobs } from "./jobs/SigilJobs.ts";
import { InvitationNotifications } from "./notifications/InvitationNotifications.ts";
import { QuestNotifications } from "./notifications/QuestNotifications.ts";
import { AppSecurityProvider } from "./providers/AppSecurityProvider.ts";
import { LoreFileAccessProvider } from "./providers/LoreFileAccessProvider.ts";
import { AchievementEngine } from "./services/AchievementEngine.ts";
import { ArchiveBlobService } from "./services/ArchiveBlobService.ts";
import { ArchiveDirectoryService } from "./services/ArchiveDirectoryService.ts";
import { ArchiveNameService } from "./services/ArchiveNameService.ts";
import { BeaconIngestService } from "./services/BeaconIngestService.ts";
import { BlightIngestService } from "./services/BlightIngestService.ts";
import { CharacterInfo } from "./services/CharacterInfo.ts";
import { FeaturePaywallService } from "./services/FeaturePaywallService.ts";
import { FeatureRegistry } from "./services/FeatureRegistry.ts";
import { FolioHistoryService } from "./services/FolioHistoryService.ts";
import { FolioLinkService } from "./services/FolioLinkService.ts";
import { InvitationService } from "./services/InvitationService.ts";
import { PetitionRateLimiter } from "./services/PetitionRateLimiter.ts";
import { AlephaLoreParser } from "./services/parsers/AlephaLoreParser.ts";
import { TrelloParser } from "./services/parsers/TrelloParser.ts";
import { QuestCsvFormatter } from "./services/QuestCsvFormatter.ts";
import { QuestCsvParser } from "./services/QuestCsvParser.ts";
import { QuestImportFormatProvider } from "./services/QuestImportFormatProvider.ts";
import { QuestService } from "./services/QuestService.ts";
import { SigilIngestSupport } from "./services/SigilIngestSupport.ts";
import { SigilService } from "./services/SigilService.ts";

export const LoreApi = $module({
  name: "lore.api",
  // The Sigils embed route applies per-sigil CORS (origin reflecting the
  // sigil's own `allowedOrigins`); `AlephaServerCors` also auto-generates
  // the `OPTIONS` preflight routes the future ingestion POSTs need.
  imports: [AlephaServerCors],
  services: [
    AppSecurityProvider,
    // Substituted for the framework's `FileAccessProvider` in
    // `main.server.ts`. Listed here only so DI scanning sees the class.
    LoreFileAccessProvider,
    CharacterInfo,
    AchievementEngine,
    FeatureRegistry,
    FeaturePaywallService,
    ArchiveNameService,
    ArchiveDirectoryService,
    ArchiveBlobService,
    FolioHistoryService,
    FolioLinkService,
    InvitationService,
    InvitationJobs,
    ChapterJobs,
    QuestJobs,
    SigilJobs,
    QuestNotifications,
    InvitationNotifications,
    PetitionRateLimiter,
    QuestCsvParser,
    QuestCsvFormatter,
    AlephaLoreParser,
    TrelloParser,
    QuestImportFormatProvider,
    QuestService,
    SigilService,
    SigilIngestSupport,
    BlightIngestService,
    BeaconIngestService,
    // Controllers
    QuestController,
    CampaignController,
    UserController,
    SessionController,
    CharacterController,
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
    SigilController,
    SigilEmbedController,
    BlightController,
    InsightsController,
    FeaturePaywallController,
    VersionController,
  ],
});
