import { $module } from "alepha";
import { AlephaApiAudits } from "alepha/api/audits";
import { AlephaApiFiles } from "alepha/api/files";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaApiNotifications } from "alepha/api/notifications";
import { AlephaApiParameters } from "alepha/api/parameters";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaApiWorkflows } from "alepha/api/workflows";
import { AlephaOrm } from "alepha/orm";

import { PlaygroundAudits } from "./PlaygroundAudits.ts";
import { PlaygroundController } from "./PlaygroundController.ts";
import { PlaygroundJobs } from "./PlaygroundJobs.ts";
import { PlaygroundNotifications } from "./PlaygroundNotifications.ts";
import { PlaygroundParameters } from "./PlaygroundParameters.ts";
import { PlaygroundRealm } from "./PlaygroundRealm.ts";
import { PlaygroundWorkflows } from "./PlaygroundWorkflows.ts";

export const PlaygroundApi = $module({
  name: "playground.api",
  imports: [
    AlephaOrm,
    // Direct-mode jobs by default — push, run in-process, sweep retries.
    // Add `.with(AlephaApiJobsQueue)` (and a queue provider) if you want
    // a real queue.
    AlephaApiJobs,
    AlephaApiWorkflows,
    AlephaApiAudits,
    AlephaApiNotifications,
    AlephaApiFiles,
    AlephaApiParameters,
    AlephaApiUsers,
  ],
  services: [
    PlaygroundRealm,
    PlaygroundJobs,
    PlaygroundWorkflows,
    PlaygroundAudits,
    PlaygroundNotifications,
    PlaygroundParameters,
    PlaygroundController,
  ],
});
