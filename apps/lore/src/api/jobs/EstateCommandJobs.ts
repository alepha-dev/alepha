import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";

import { EstateCommandService } from "../services/EstateCommandService.ts";
import { ProjectLimits } from "../services/ProjectLimits.ts";

/**
 * One sweep for the two things a command queue must not do: leave a stuck
 * command looking eternally in progress, and grow without bound.
 *
 * Every five minutes rather than every minute: the deadlines are two and
 * fifteen minutes, so a stuck command is called out within five minutes of
 * its deadline, and a per-minute cron on a Worker would cost more than the
 * whole connector's traffic (folio #1184's cost table).
 *
 * The cap lives on `ProjectLimits`, so an admin bumps it from
 * `/admin/parameters` with no redeploy, the same way `quality_runs` is capped.
 */
export class EstateCommandJobs {
  protected readonly log = $logger();
  protected readonly commands = $inject(EstateCommandService);
  protected readonly limits = $inject(ProjectLimits);

  public readonly sweepEstateCommands = $job({
    cron: "*/5 * * * *",
    handler: async () => {
      const failed = await this.commands.sweep();
      const pruned = await this.commands.prune(
        await this.limits.maxCommandsPerEstate(),
      );
      if (failed > 0 || pruned > 0) {
        this.log.info("Swept estate commands", { failed, pruned });
      }
    },
  });
}
