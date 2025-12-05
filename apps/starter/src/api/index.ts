import { $module } from "alepha";
import { ApiDoc } from "./ApiDoc.ts";
import { ApiSecurity } from "./ApiSecurity.ts";
import { ApiSeed } from "./ApiSeed.ts";
import { TaskController } from "./controllers/TaskController.ts";

export const StarterApi = $module({
  name: "starter.api",
  services: [ApiDoc, ApiSeed, ApiSecurity, TaskController],
});
