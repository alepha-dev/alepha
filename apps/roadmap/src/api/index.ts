import { $module } from "alepha";
import { AdminController } from "./controllers/AdminController.ts";
import { CharacterController } from "./controllers/CharacterController.ts";
import { IdentityController } from "./controllers/IdentityController.ts";
import { InvitationController } from "./controllers/InvitationController.ts";
import { ProjectController } from "./controllers/ProjectController.ts";
import { ProjectStatsController } from "./controllers/ProjectStatsController.ts";
import { SessionController } from "./controllers/SessionController.ts";
import { TaskController } from "./controllers/TaskController.ts";
import { UserController } from "./controllers/UserController.ts";
import { Db } from "./providers/Db.ts";
import { Security } from "./providers/Security.ts";
import { CharacterInfo } from "./services/CharacterInfo.ts";

export const RoadmapApi = $module({
  name: "roadmap.api",
  services: [
    Security,
    Db,
    CharacterInfo,
    TaskController,
    ProjectController,
    UserController,
    SessionController,
    CharacterController,
    IdentityController,
    ProjectStatsController,
    InvitationController,
    AdminController,
  ],
});

export * from "./controllers/AdminController.ts";
export * from "./controllers/CharacterController.ts";
export * from "./controllers/IdentityController.ts";
export * from "./controllers/InvitationController.ts";
export * from "./controllers/ProjectController.ts";
export * from "./controllers/ProjectStatsController.ts";
export * from "./controllers/SessionController.ts";
export * from "./controllers/TaskController.ts";
export * from "./controllers/UserController.ts";
export * from "./entities/characters.ts";
export * from "./entities/files.ts";
export * from "./entities/identities.ts";
export * from "./entities/invitations.ts";
export * from "./entities/projects.ts";
export * from "./entities/sessions.ts";
export * from "./entities/tasks.ts";
export * from "./entities/users.ts";
export * from "./providers/Db.ts";
export * from "./providers/Security.ts";
export * from "./schemas/taskCreateSchema.ts";
export * from "./services/CharacterInfo.ts";
