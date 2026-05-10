import { $module } from "alepha";
import { AdminInvitationController } from "./controllers/AdminInvitationController.ts";
import { BeaconController } from "./controllers/BeaconController.ts";
import { CampaignController } from "./controllers/CampaignController.ts";
import { CampaignStatsController } from "./controllers/CampaignStatsController.ts";
import { ChapterController } from "./controllers/ChapterController.ts";
import { CharacterController } from "./controllers/CharacterController.ts";
import { FolioController } from "./controllers/FolioController.ts";
import { IdentityController } from "./controllers/IdentityController.ts";
import { InvitationController } from "./controllers/InvitationController.ts";
import { KanbanController } from "./controllers/KanbanController.ts";
import { QuestController } from "./controllers/QuestController.ts";
import { SessionController } from "./controllers/SessionController.ts";
import { UserController } from "./controllers/UserController.ts";
import { WhiteboardController } from "./controllers/WhiteboardController.ts";
import { InvitationJobs } from "./jobs/InvitationJobs.ts";
import { AppSecurityProvider } from "./providers/AppSecurityProvider.ts";
import { BeaconRateLimiter } from "./services/BeaconRateLimiter.ts";
import { CharacterInfo } from "./services/CharacterInfo.ts";
import { InvitationService } from "./services/InvitationService.ts";

export const RoadmapApi = $module({
  name: "roadmap.api",
  services: [
    AppSecurityProvider,
    CharacterInfo,
    InvitationService,
    InvitationJobs,
    BeaconRateLimiter,
    // Controllers
    QuestController,
    CampaignController,
    UserController,
    SessionController,
    CharacterController,
    ChapterController,
    IdentityController,
    CampaignStatsController,
    InvitationController,
    AdminInvitationController,
    WhiteboardController,
    KanbanController,
    FolioController,
    BeaconController,
  ],
});
