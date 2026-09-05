import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";

import { EstateCommandService } from "../services/EstateCommandService.ts";
import { ProjectLimits } from "../services/ProjectLimits.ts";

/**
 * One sweep for the two things a command queue must not do: leave a stuck
 * command looking eternally in progress, and grow without bound.
 *
 * On the quarter hour, which is an expression Lore already emits: a Worker's
 * cron triggers are counted per account and shared across every Worker on
 * it, so a new cadence is a new trigger and a shared one is free. A stuck
 * command is therefore called out within fifteen minutes of its deadline,
 * which is what "not eternally in progress" needs, and a per-minute cron
 * would cost more than the whole connector's traffic (folio #1184).
 *
 * The cap lives on `ProjectLimits`, so an admin bumps it from
 * `/admin/parameters` with no redeploy, the same way `quality_runs` is capped.
 */
export class EstateCommandJobs {
  protected readonly log = $logger();
  protected readonly commands = $inject(EstateCommandService);
  protected readonly limits = $inject(ProjectLimits);

  public readonly sweepEstateCommands = $job({
    cron: "*/15 * * * *",
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
