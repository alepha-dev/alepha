import { ProjectLimits } from "@lore/core/api";
import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";

import { HostCommandService } from "../services/HostCommandService.ts";

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
export class HostCommandJobs {
  protected readonly log = $logger();
  protected readonly commands = $inject(HostCommandService);
  protected readonly limits = $inject(ProjectLimits);

  public readonly sweepHostCommands = $job({
    name: "hosts.sweep-commands",
    description:
      "Fails host commands that stopped reporting, then prunes each host's command history to its limit.",
    cron: "*/15 * * * *",
    // One minute, against a trigger that measures 1.3 s at p99. Two
    // bounded service calls; if this ever approaches a minute, something
    // is wrong that a longer timeout would only hide.
    timeout: [60, "seconds"],
    handler: async () => {
      const failed = await this.commands.sweep();
      const pruned = await this.commands.prune(
        await this.limits.maxCommandsPerHost(),
      );
      if (failed > 0 || pruned > 0) {
        this.log.info("Swept host commands", { failed, pruned });
      }
    },
  });
}
