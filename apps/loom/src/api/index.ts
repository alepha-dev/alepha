import { $module } from "alepha";

import { LoomController } from "./controllers/LoomController.ts";
import { CiService } from "./services/CiService.ts";
import { ClaudeService } from "./services/ClaudeService.ts";
import { DevServerService } from "./services/DevServerService.ts";
import { GitService } from "./services/GitService.ts";
import { LoreService } from "./services/LoreService.ts";
import { ProjectStateService } from "./services/ProjectStateService.ts";
import { ProjectStore } from "./services/ProjectStore.ts";
import { VerifyService } from "./services/VerifyService.ts";

/**
 * The server half: the project list and everything Loom reads about a
 * project's worktrees. Every source is a local command (`git`, `gh`, `lsof`,
 * `ps`, `grep`) or, for quest titles, the Lore API.
 *
 * @module loom.api
 */
export const LoomApi = $module({
  name: "loom.api",
  services: [
    LoomController,
    ProjectStore,
    ProjectStateService,
    GitService,
    CiService,
    LoreService,
    ClaudeService,
    DevServerService,
    VerifyService,
  ],
});
