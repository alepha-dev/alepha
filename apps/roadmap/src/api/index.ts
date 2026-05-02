import { $module } from "alepha";
import { AdminInvitationController } from "./controllers/AdminInvitationController.ts";
import { ChapterController } from "./controllers/ChapterController.ts";
import { CharacterController } from "./controllers/CharacterController.ts";
import { FolioController } from "./controllers/FolioController.ts";
import { IdentityController } from "./controllers/IdentityController.ts";
import { InvitationController } from "./controllers/InvitationController.ts";
import { KanbanController } from "./controllers/KanbanController.ts";
import { ProjectController } from "./controllers/ProjectController.ts";
import { ProjectStatsController } from "./controllers/ProjectStatsController.ts";
import { SessionController } from "./controllers/SessionController.ts";
import { TaskController } from "./controllers/TaskController.ts";
import { UserController } from "./controllers/UserController.ts";
import { WhiteboardController } from "./controllers/WhiteboardController.ts";
import { InvitationJobs } from "./jobs/InvitationJobs.ts";
import { AppSecurityProvider } from "./providers/AppSecurityProvider.ts";
import { CharacterInfo } from "./services/CharacterInfo.ts";
import { InvitationService } from "./services/InvitationService.ts";

export const RoadmapApi = $module({
  name: "roadmap.api",
  services: [
    AppSecurityProvider,
    CharacterInfo,
    InvitationService,
    InvitationJobs,
    // Controllers
    TaskController,
    ProjectController,
    UserController,
    SessionController,
    CharacterController,
    ChapterController,
    IdentityController,
    ProjectStatsController,
    InvitationController,
    AdminInvitationController,
    WhiteboardController,
    KanbanController,
    FolioController,
  ],
});
