import { ProjectTools } from "@lore/core/mcp";
import { $inject } from "alepha";
import { $tool } from "alepha/mcp";

import { AgentHostController } from "../../api/controllers/AgentHostController.ts";
import {
  agentHostsParamsSchema,
  agentHostsResultSchema,
} from "../schemas/agentHostSchemas.ts";

/**
 * `agent_hosts` (#Q4225), split out of core's `JobTools` with the Agent
 * host controller (#E175). The `job_*` tools stay core's: a job is a host
 * job, and its history outlives the capability.
 */
export class AgentHostTools {
  protected readonly projects = $inject(ProjectTools);
  protected readonly agentHosts = $inject(AgentHostController);

  agent_hosts = $tool({
    title: "List Agent hosts",
    description:
      "The project's Agent hosts, its own and those lent to it: each one's last check (available or not, and why), the agent CLIs it reports (what agent_run's `agent` names), and every tool its jobs user has (agent CLIs, git, gh, lore) with a version or the error of its version command. Whether a tool is signed in is not checked. Readable by members whose rank grants host:read.",
    annotations: { readOnlyHint: true },
    schema: { params: agentHostsParamsSchema, result: agentHostsResultSchema },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      const { items } = await this.agentHosts.listProjectAgentHosts({
        params: { projectId },
      });
      return { hosts: items };
    },
  });
}
