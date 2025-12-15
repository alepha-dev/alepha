import { $module } from "alepha";
import { DeviceController } from "./controllers/DeviceController.ts";

export const SaasDevices = $module({
  name: "saas.api.devices",
  services: [DeviceController],
});
