import { $module } from "alepha";
import { AppDetailController } from "./controllers/AppDetailController.ts";
import { IngestController } from "./controllers/IngestController.ts";
import { PulseAppController } from "./controllers/PulseAppController.ts";
import { ForwardJobs } from "./jobs/ForwardJobs.ts";
import { PulseSecurityProvider } from "./providers/PulseSecurityProvider.ts";
import { AppKeyService } from "./services/AppKeyService.ts";
import { IngestService } from "./services/IngestService.ts";
import { LoreForwardService } from "./services/LoreForwardService.ts";

/**
 * Pulse's server — analytics, errors, web vitals and app-reported metrics.
 *
 * Moved here out of bay-admin, where it grew up because bay-admin *was* Pulse
 * for a few days. Nothing in this module may learn what a deployment is:
 * Pulse has to work for an app on Cloudflare or Vercel, and the moment it
 * knows about Bay it stops being that.
 *
 * ⚠️ Incomplete. See `TODO.md` — the enrolment UI, the app skeleton's web
 * routes and the never-executed Lore forwarder still need finishing.
 */
export const PulseApi = $module({
  name: "pulse.api",
  services: [
    PulseSecurityProvider,
    AppKeyService,
    IngestService,
    IngestController,
    PulseAppController,
    AppDetailController,
    LoreForwardService,
    ForwardJobs,
  ],
});
