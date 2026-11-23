import { $ownsProject } from "@lore/core/api";
import { agentRunChoiceSchema, agentRunSchema } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { EpicAgentService } from "../services/EpicAgentService.ts";

/**
 * Review with an agent (#Q4214): an epic's Review prompt run as an agent job
 * on the project's Agent host, its key pinned to the epic. Starting it takes
 * `epic:write`, since the job writes back to the epic and its quests as the
 * member who started it, bounded by their rank.
 */
export class EpicAgentController {
  protected readonly service = $inject(EpicAgentService);

  reviewEpicWithAgent = $action({
    use: [$ownsProject({ param: "projectId", requires: "epic:write" })],
    method: "POST",
    path: "/projects/:projectId/epics/:number/agent-review",
    schema: {
      params: z.object({ projectId: z.integer(), number: z.integer() }),
      body: agentRunSchema.nullish(),
      response: z.object({ jobId: z.uuid() }),
    },
    handler: async ({ params, body, user }) =>
      this.service.review(params.projectId, params.number, user.id, body ?? {}),
  });

  /**
   * Whether a review can run now, and on which hosts and agents (#Q4223):
   * an available Agent host. The epic page's menu entry shows only then.
   */
  getEpicAgentReview = $action({
    use: [$ownsProject({ param: "projectId", requires: "epic:write" })],
    method: "GET",
    path: "/projects/:projectId/epics-agent-review",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({
        ready: z.boolean(),
        choices: z.array(agentRunChoiceSchema),
      }),
    },
    handler: async ({ params }) => {
      const choices = await this.service.agentChoices(params.projectId);
      return { ready: choices.length > 0, choices };
    },
  });
}
