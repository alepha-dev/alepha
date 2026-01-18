import { $module } from "alepha";
import { SseMcpTransport } from "alepha/mcp";
import { CharacterController } from "./controllers/CharacterController.ts";
import { IdentityController } from "./controllers/IdentityController.ts";
import { InvitationController } from "./controllers/InvitationController.ts";
import { McpApiKeyController } from "./controllers/McpApiKeyController.ts";
import { ProjectController } from "./controllers/ProjectController.ts";
import { ProjectStatsController } from "./controllers/ProjectStatsController.ts";
import { SessionController } from "./controllers/SessionController.ts";
import { TaskController } from "./controllers/TaskController.ts";
import { UserController } from "./controllers/UserController.ts";
import { WhiteboardController } from "./controllers/WhiteboardController.ts";
import { AppSecurityProvider } from "./providers/AppSecurityProvider.ts";
import { McpAuthProvider } from "./providers/McpAuthProvider.ts";
import { ProjectResources } from "./resources/ProjectResources.ts";
import { CharacterInfo } from "./services/CharacterInfo.ts";
import { ProjectTools } from "./tools/ProjectTools.ts";
import { TaskTools } from "./tools/TaskTools.ts";

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
    McpApiKeyController,
    WhiteboardController,
    // MCP
    SseMcpTransport,
    McpAuthProvider,
    TaskTools,
    ProjectTools,
    ProjectResources,
  ],
});
