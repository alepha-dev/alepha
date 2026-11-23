import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { OwnedResourceProvider } from "alepha/security";
import { $action } from "alepha/server";

import { type Host, hosts } from "../entities/hosts.ts";
import { hostJobToolSchema } from "../schemas/hostInventoryJobsSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { AgentHostService } from "../services/AgentHostService.ts";

/**
 * Agent hosts (#Q3985): the project's Agent hosts with what each has
 * (#Q4225), and the capability check on demand. Making a host an Agent host
 * is a switch of `updateHost`, under `host:update` in its home project.
 */
export class AgentHostController {
  protected readonly agents = $inject(AgentHostService);
  protected readonly hostRows = $repository(hosts);
  protected readonly owned = $inject(OwnedResourceProvider);

  /**
   * The project's Agent hosts (#Q4225): its own and those lent to it, each
   * with its last check and what its jobs user has, the agent CLIs first.
   * What `lore agent hosts` and `agent_hosts` print.
   */
  listProjectAgentHosts = $action({
    use: [$ownsProject({ param: "projectId", requires: "host:read" })],
    method: "GET",
    path: "/projects/:projectId/agent-hosts",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({
        items: z.array(
          z.object({
            id: z.uuid(),
            slug: z.string(),
            status: z.string().optional(),
            checkedAt: z.string().optional(),
            error: z.string().optional(),
            agents: z.array(z.string()),
            tools: z.array(hostJobToolSchema),
          }),
        ),
      }),
    },
    handler: async ({ params }) => {
      const hosts = await this.agents.list(params.projectId);
      return {
        items: hosts.map((host) => ({
          id: host.id,
          slug: host.slug,
          ...(host.agentStatus ? { status: host.agentStatus } : {}),
          ...(host.agentCheckedAt ? { checkedAt: host.agentCheckedAt } : {}),
          ...(host.agentError ? { error: host.agentError } : {}),
          agents: AgentHostService.agentsOf(host.jobsTools),
          tools: host.jobsTools ?? [],
        })),
      };
    },
  });

  /**
   * Checks an Agent host now. Answers the check job's id, or nothing when a
   * check is already queued or running.
   */
  checkAgentHost = $action({
    use: [
      $ownsProject({
        repository: () => this.hostRows,
        param: "hostId",
        requires: "host:update",
      }),
    ],
    method: "POST",
    path: "/hosts/:hostId/agent-check",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      response: z.object({ jobId: z.uuid().optional() }),
    },
    handler: async ({ user }) => {
      const host = this.owned.get<Host>();
      const jobId = await this.agents.check(host.id, user?.id);
      return jobId ? { jobId } : {};
    },
  });
}
