import { $module } from "alepha";
import { AlephaApiAudits } from "alepha/api/audits";
import { AlephaApiFiles } from "alepha/api/files";
import { AlephaApiJobs, AlephaApiJobsQueue } from "alepha/api/jobs";
import { AlephaApiNotifications } from "alepha/api/notifications";
import { AlephaApiParameters } from "alepha/api/parameters";
import { AlephaOrm } from "alepha/orm";
import { PlaygroundAudits } from "./PlaygroundAudits.ts";
import { PlaygroundController } from "./PlaygroundController.ts";
import { PlaygroundDevAuth } from "./PlaygroundDevAuth.ts";
import { PlaygroundJobs } from "./PlaygroundJobs.ts";
import { PlaygroundNotifications } from "./PlaygroundNotifications.ts";
import { PlaygroundParameters } from "./PlaygroundParameters.ts";

export const PlaygroundApi = $module({
  name: "playground.api",
  imports: [
    AlephaOrm,
    AlephaApiJobs,
    AlephaApiJobsQueue,
    AlephaApiAudits,
    AlephaApiNotifications,
    AlephaApiFiles,
    AlephaApiParameters,
  ],
  services: [
    PlaygroundDevAuth,
    PlaygroundJobs,
    PlaygroundAudits,
    PlaygroundNotifications,
    PlaygroundParameters,
    PlaygroundController,
  ],
});
