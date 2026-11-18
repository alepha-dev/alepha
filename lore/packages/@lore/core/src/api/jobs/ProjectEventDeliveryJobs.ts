import { $inject, z } from "alepha";
import { $job } from "alepha/api/jobs";
import { $repository } from "alepha/orm";

import { projectEvents } from "../entities/projectEvents.ts";
import { ProjectEventDelivery } from "../services/ProjectEventDelivery.ts";

/**
 * The delivery of one project event (#Q3890), run from the queue. Its row
 * is written by `ProjectEvents.emit` in the change's own batch, never pushed
 * here: see `ProjectEventDelivery`.
 */
export class ProjectEventDeliveryJobs {
  protected readonly delivery = $inject(ProjectEventDelivery);
  protected readonly events = $repository(projectEvents);

  public readonly deliver = $job({
    // `ProjectEventDelivery.JOB`, spelled out for the job-name convention.
    name: "project-events.deliver",
    description:
      "Tells the members subscribed to a project event, once per subscription and channel.",
    schema: z.object({ eventId: z.uuid() }),
    retry: { retries: 3 },
    retention: { ok: { days: 7 }, error: { days: 30 } },
    handler: async ({ payload, step }) => {
      const event = await this.events.findById(payload.eventId);
      // Pruned or merged away since: nobody is left to tell.
      if (!event) return;
      await this.delivery.deliver(event, (name, fn) => step.run(name, fn));
    },
  });
}
