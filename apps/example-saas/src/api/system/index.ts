import { $module } from "alepha";
import { AlephaApiParameters } from "alepha/api/parameters";
import { SeedController } from "./controllers/SeedController.ts";
import { AppConfig } from "./services/AppConfig.ts";

export { AppConfig } from "./services/AppConfig.ts";

export const SaasSystem = $module({
  name: "saas.api.system",
  services: [AlephaApiParameters, AppConfig, SeedController],
});
