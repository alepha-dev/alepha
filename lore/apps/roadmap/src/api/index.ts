import { $module } from "alepha";
import { CharacterController } from "./controllers/CharacterController.ts";
import { IdentityController } from "./controllers/IdentityController.ts";
import { InvitationController } from "./controllers/InvitationController.ts";
import { ProjectController } from "./controllers/ProjectController.ts";
import { ProjectStatsController } from "./controllers/ProjectStatsController.ts";
import { SessionController } from "./controllers/SessionController.ts";
import { TaskController } from "./controllers/TaskController.ts";
import { UserController } from "./controllers/UserController.ts";
import { WhiteboardController } from "./controllers/WhiteboardController.ts";
import { AppSecurityProvider } from "./providers/AppSecurityProvider.ts";
import { CharacterInfo } from "./services/CharacterInfo.ts";

export const RoadmapApi = $module({
  name: "roadmap.api",
  services: [
    AppSecurityProvider,
    CharacterInfo,
    // Controllers
    TaskController,
    ProjectController,
    UserController,
    SessionController,
    CharacterController,
    IdentityController,
    ProjectStatsController,
    InvitationController,
    WhiteboardController,
  ],
});
