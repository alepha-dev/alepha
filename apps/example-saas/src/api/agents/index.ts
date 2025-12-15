import { $module } from "alepha";
import { AgentController } from "./controllers/AgentController.ts";

export const SaasAgents = $module({
  name: "saas.api.agents",
  services: [AgentController],
});
