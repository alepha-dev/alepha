import type { AgentHostController } from "@lore/prompts/api";
import { $inject, z } from "alepha";
import { $command } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore agent hosts`: the project's Agent hosts (#Q4225), the twin of
 * `agent_hosts`. A prompt runs on one with `lore prompt run` (#Q4282), and
 * `lore job` reads and follows the job.
 */
export class AgentCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly hostsApi = $client<AgentHostController>(
    this.client.scope(),
  );

  public readonly hosts = $command({
    name: "hosts",
    description:
      "The project's Agent hosts, each with its last check, its agent CLIs and the tools its jobs user has",
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description: "The project, by slug or id. Defaults to LORE_PROJECT.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const { items } = await this.hostsApi.listProjectAgentHosts({
          params: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, { hosts: items });
          return;
        }
        this.render.list(
          print,
          items.map((host) => ({
            handle: host.slug,
            title: host.status ?? "unchecked",
            fields: [
              host.agents.length
                ? `agents: ${host.agents.join(", ")}`
                : "no agent CLI",
              ...host.tools.map((tool) =>
                tool.found
                  ? `${tool.name} ${tool.error ? `(${tool.error})` : (tool.version ?? "")}`.trim()
                  : `${tool.name} missing`,
              ),
              ...(host.error ? [host.error] : []),
            ],
          })),
          undefined,
          "This project has no Agent host.",
        );
      });
    },
  });

  public readonly agent = $command({
    name: "agent",
    description:
      "The project's Agent hosts; a prompt runs on one with lore prompt run",
    children: [this.hosts],
    handler: async ({ help }) => {
      help();
    },
  });
}
