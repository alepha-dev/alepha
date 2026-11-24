import { ProjectTools } from "@lore/core/mcp";
import { $inject } from "alepha";
import { $tool } from "alepha/mcp";

import { AgentRunController } from "../../api/controllers/AgentRunController.ts";
import {
  agentRunParamsSchema,
  agentRunResultSchema,
} from "../schemas/agentRunSchemas.ts";

/**
 * Run a prompt on an Agent host (#Q4225), the twin of `lore agent run`.
 * Called from an agent job's own key it is refused: a job never starts a
 * job (#Q4222).
 */
export class AgentTools {
  protected readonly runs = $inject(AgentRunController);
  protected readonly projects = $inject(ProjectTools);

  agent_run = $tool({
    title: "Run a prompt on an Agent host",
    description:
      "Start an agent job on one of the project's Agent hosts: `triage` runs the project's Triage prompt over the feedback inbox and the open errors (feedback:triage), `build` the Build prompt on one accepted quest (quest:update), `review-pr` the Review prompt on a pull request (quest:update), `text` your own words (host:update). Name `host` when the project has several Agent hosts and `agent` when the host reports several (agent_hosts lists them). Answers the job's id: follow it with job_get. An agent job cannot start another.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: { params: agentRunParamsSchema, result: agentRunResultSchema },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      return this.runs.runAgent({
        params: { projectId },
        body: {
          prompt: params.prompt,
          ...(params.quest === undefined ? {} : { quest: params.quest }),
          ...(params.pr === undefined ? {} : { pr: params.pr }),
          ...(params.fix ? { fix: true } : {}),
          ...(params.trust ? { trust: true } : {}),
          ...(params.text ? { text: params.text } : {}),
          ...(params.host ? { host: params.host } : {}),
          ...(params.agent ? { agent: params.agent } : {}),
          ...(params.model ? { model: params.model } : {}),
          ...(params.workspace ? { workspace: params.workspace } : {}),
          ...(params.source ? { source: params.source } : {}),
          ...(params.ref ? { ref: params.ref } : {}),
          ...(params.timeout ? { timeout: params.timeout } : {}),
        },
      });
    },
  });
}
