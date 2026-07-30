import { $module } from "alepha";
import { BayAppController } from "./controllers/BayAppController.ts";
import { DeviceController } from "./controllers/DeviceController.ts";
import { BaySecurityProvider } from "./providers/BaySecurityProvider.ts";
import { BayControlService } from "./services/BayControlService.ts";

export const BayUiApi = $module({
  name: "bay-ui.api",
  services: [
    // Declares the `$realm`. Nothing injects it — it must be listed here
    // explicitly or the realm (and every permission) is never registered.
    BaySecurityProvider,
    BayControlService,
    BayAppController,
    DeviceController,
  ],
});
