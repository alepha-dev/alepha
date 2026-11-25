import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";

import { AgentHostService } from "../services/AgentHostService.ts";

/**
 * The daily capability check of every Agent host (#Q3985), on the 03:00
 * expression Lore already emits: a shared cron trigger is free on
 * Cloudflare, a new one is not.
 */
export class AgentHostJobs {
  protected readonly log = $logger();
  protected readonly agents = $inject(AgentHostService);

  public readonly checkAgentHosts = $job({
    name: "hosts.check-agents",
    description:
      "Checks every Agent host with a one-turn Claude Code prompt, so an expired credential or a reached usage limit shows on the host before a job fails on it.",
    cron: "0 3 * * *",
    timeout: [60, "seconds"],
    handler: async () => {
      const started = await this.agents.checkAll();
      if (started > 0) {
        this.log.info("Agent host checks started", { started });
      }
    },
  });
}
