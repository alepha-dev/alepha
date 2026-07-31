import { $module } from "alepha";
import { AppDetailController } from "./controllers/AppDetailController.ts";
import { BayAppController } from "./controllers/BayAppController.ts";
import { DeviceController } from "./controllers/DeviceController.ts";
import { IngestController } from "./controllers/IngestController.ts";
import { PulseAppController } from "./controllers/PulseAppController.ts";
import { ForwardJobs } from "./jobs/ForwardJobs.ts";
import { BaySecurityProvider } from "./providers/BaySecurityProvider.ts";
import { AppKeyService } from "./services/AppKeyService.ts";
import { BayAppSyncService } from "./services/BayAppSyncService.ts";
import { BayControlService } from "./services/BayControlService.ts";
import { IngestService } from "./services/IngestService.ts";
import { LoreForwardService } from "./services/LoreForwardService.ts";

export const PulseApi = $module({
  name: "pulse.api",
  services: [
    // Declares the `$realm`. Nothing injects it — it must be listed here
    // explicitly or the realm (and every permission) is never registered.
    BaySecurityProvider,
    BayControlService,
    BayAppSyncService,
    BayAppController,
    DeviceController,
    // Telemetry intake. Its own credential, its own realm — see
    // `IngestController` for why the two never overlap.
    AppKeyService,
    IngestService,
    IngestController,
    PulseAppController,
    AppDetailController,
    LoreForwardService,
    ForwardJobs,
  ],
});
