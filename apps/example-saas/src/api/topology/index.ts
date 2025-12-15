import { $module } from "alepha";
import { StationController } from "./controllers/StationController.ts";
import { TripController } from "./controllers/TripController.ts";

export const SaasTopology = $module({
  name: "saas.api.topology",
  services: [StationController, TripController],
});
