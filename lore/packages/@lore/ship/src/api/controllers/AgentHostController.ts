import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { OwnedResourceProvider } from "alepha/security";
import { $action } from "alepha/server";

import { type Host, hosts } from "../entities/hosts.ts";
import { AgentHostService } from "../services/AgentHostService.ts";

/**
 * Agent hosts (#Q3985): the capability check on demand, and the project's
 * default Agent host. Making a host an Agent host is a switch of
 * `updateHost`, under `host:update` in its home project.
 */
export class AgentHostController {
  protected readonly agents = $inject(AgentHostService);
  protected readonly hostRows = $repository(hosts);
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
        capability: { key: "ship" as const, action: "check an Agent host" },
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
   * Names the project's default Agent host, or clears it with `null`.
   */
  setProjectAgentHost = $action({
    use: [
      $ownsProject({
        param: "projectId",
        requires: "host:update",
        capability: { key: "ship" as const, action: "name an Agent host" },
      }),
    ],
    method: "PUT",
    path: "/projects/:projectId/agent-host",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({ hostId: z.uuid().nullable() }),
      response: z.object({ hostId: z.uuid().optional() }),
    },
    handler: async ({ params, body }) => {
      await this.agents.setDefault(params.projectId, body.hostId);
      return body.hostId ? { hostId: body.hostId } : {};
    },
  });
}
