import { $module } from "alepha";
import { SeatLayoutController } from "./controllers/SeatLayoutController.ts";

export const SaasVehicles = $module({
  name: "saas.api.vehicles",
  services: [SeatLayoutController],
});
