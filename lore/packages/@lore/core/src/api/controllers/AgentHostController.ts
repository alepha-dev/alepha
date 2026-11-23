import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { OwnedResourceProvider } from "alepha/security";
import { $action } from "alepha/server";

import { type Host, hosts } from "../entities/hosts.ts";
import { projects } from "../entities/projects.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { AgentHostService } from "../services/AgentHostService.ts";

/**
 * Agent hosts (#Q3985): the capability check on demand, and the project's
 * default Agent host. Making a host an Agent host is a switch of
 * `updateHost`, under `host:update` in its home project.
 */
export class AgentHostController {
  protected readonly agents = $inject(AgentHostService);
  protected readonly hostRows = $repository(hosts);
  protected readonly projectRows = $repository(projects);
  protected readonly owned = $inject(OwnedResourceProvider);

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

  /**
   * The hosts a `push` agent job of the project reaches beyond Anthropic and
   * Lore (#Q3996), or `null` for the default list. Bare host names, a
   * leading dot for every subdomain (`.githubusercontent.com`).
   */
  setProjectAgentEgress = $action({
    use: [
      $ownsProject({
        param: "projectId",
        requires: "host:update",
      }),
    ],
    method: "PUT",
    path: "/projects/:projectId/agent-egress",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        hosts: z
          .array(
            z
              .text({ maxLength: 253 })
              .regex(
                /^\.?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/,
              ),
          )
          .max(50)
          .nullable(),
      }),
      response: z.object({ hosts: z.array(z.string()).optional() }),
    },
    handler: async ({ params, body }) => {
      await this.projectRows.updateById(params.projectId, {
        agentEgressHosts: body.hosts,
      });
      return body.hosts ? { hosts: body.hosts } : {};
    },
  });
}
