import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";

import { ProjectEvents } from "../services/ProjectEvents.ts";

/**
 * The nightly prune of project events (#Q3889), on `0 0 * * *`, an
 * expression the Worker already runs: no trigger is added.
 */
export class ProjectEventJobs {
  protected readonly events = $inject(ProjectEvents);

  public readonly prune = $job({
    name: "project-events.prune",
    description: `Deletes project events older than ${ProjectEvents.RETENTION_DAYS} days, at most ${ProjectEvents.PRUNE_LIMIT} a night.`,
    cron: "0 0 * * *",
    handler: async () => {
      await this.events.prune();
    },
  });
}
