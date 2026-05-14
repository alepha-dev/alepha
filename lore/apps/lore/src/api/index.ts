import { $module } from "alepha";
import { AdminInvitationController } from "./controllers/AdminInvitationController.ts";
import { CampaignController } from "./controllers/CampaignController.ts";
import { CampaignQuestPortabilityController } from "./controllers/CampaignQuestPortabilityController.ts";
import { CampaignStatsController } from "./controllers/CampaignStatsController.ts";
import { ChapterController } from "./controllers/ChapterController.ts";
import { CharacterController } from "./controllers/CharacterController.ts";
import { FolioController } from "./controllers/FolioController.ts";
import { IdentityController } from "./controllers/IdentityController.ts";
import { InvitationController } from "./controllers/InvitationController.ts";
import { KanbanController } from "./controllers/KanbanController.ts";
import { PetitionController } from "./controllers/PetitionController.ts";
import { QuestController } from "./controllers/QuestController.ts";
import { SessionController } from "./controllers/SessionController.ts";
import { UserController } from "./controllers/UserController.ts";
import { ChapterJobs } from "./jobs/ChapterJobs.ts";
import { InvitationJobs } from "./jobs/InvitationJobs.ts";
import { AppSecurityProvider } from "./providers/AppSecurityProvider.ts";
import { CharacterInfo } from "./services/CharacterInfo.ts";
import { FolioLinkService } from "./services/FolioLinkService.ts";
import { InvitationService } from "./services/InvitationService.ts";
import { PetitionRateLimiter } from "./services/PetitionRateLimiter.ts";
import { AlephaLoreParser } from "./services/parsers/AlephaLoreParser.ts";
import { TrelloParser } from "./services/parsers/TrelloParser.ts";
import { QuestCsvFormatter } from "./services/QuestCsvFormatter.ts";
import { QuestCsvParser } from "./services/QuestCsvParser.ts";
import { QuestImportFormatProvider } from "./services/QuestImportFormatProvider.ts";

export const LoreApi = $module({
  name: "lore.api",
  services: [
    AppSecurityProvider,
    CharacterInfo,
    FolioLinkService,
    InvitationService,
    InvitationJobs,
    ChapterJobs,
    PetitionRateLimiter,
    QuestCsvParser,
    QuestCsvFormatter,
    AlephaLoreParser,
    TrelloParser,
    QuestImportFormatProvider,
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
    PetitionController,
  ],
});
