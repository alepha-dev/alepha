import { $module } from "alepha";
import { AppUsageController } from "./controllers/AppUsageController.ts";
import { BayAppController } from "./controllers/BayAppController.ts";
import { DeviceController } from "./controllers/DeviceController.ts";
import { AppUsageJobs } from "./jobs/AppUsageJobs.ts";
import { BaySecurityProvider } from "./providers/BaySecurityProvider.ts";
import { AppUsageService } from "./services/AppUsageService.ts";
import { BayControlService } from "./services/BayControlService.ts";
import { BootstrapService } from "./services/BootstrapService.ts";

export const BayAdminApi = $module({
  name: "bay-admin.api",
  services: [
    // Declares the `$realm`. Nothing injects it — it must be listed here
    // explicitly or the realm (and every permission) is never registered.
    BaySecurityProvider,
    // Creates the one operator account at first boot. There is no sign-up
    // form and no mail provider, so without this nobody can ever log in.
    BootstrapService,
    BayControlService,
    BayAppController,
    DeviceController,
    // The supervisor series: what each app costs, sampled from Bay every
    // minute. Infrastructure, not telemetry — no app reports anything.
    AppUsageService,
    AppUsageController,
    AppUsageJobs,
  ],
});
