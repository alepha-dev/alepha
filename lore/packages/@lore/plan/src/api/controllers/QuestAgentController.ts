import { $ownsProject } from "@lore/core/api";
import { agentRunChoiceSchema, agentRunSchema } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { QuestAgentService } from "../services/QuestAgentService.ts";

/**
 * Work it with an agent (#Q3989): an accepted quest worked by an agent job
 * that pushes `lore/q<n>`, and the confirmation an untrusted quest needs
 * first. Starting the job takes `code:write`: its key pushes as the member
 * who started it, bounded by their rank.
 */
export class QuestAgentController {
  protected readonly service = $inject(QuestAgentService);

  workQuestWithAgent = $action({
    use: [$ownsProject({ param: "projectId", requires: "code:write" })],
    method: "POST",
    path: "/projects/:projectId/quests/:shortId/agent-work",
    schema: {
      params: z.object({ projectId: z.integer(), shortId: z.integer() }),
      // The host, agent and model of the run (#Q4223), each optional.
      body: agentRunSchema.nullish(),
      response: z.object({ jobId: z.uuid() }),
    },
    handler: async ({ params, body, user }) =>
      this.service.work(params.projectId, params.shortId, user.id, body ?? {}),
  });

  /**
   * Whether an agent can work a quest now, and on which hosts and agents
   * (#Q4223): the quest's agent entry offers one click with one choice, a
   * small picker with several, nothing with none.
   */
  getQuestAgentWork = $action({
    use: [$ownsProject({ param: "projectId", requires: "code:write" })],
    method: "GET",
    path: "/projects/:projectId/quests-agent-work",
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

  confirmUntrustedQuest = $action({
    use: [$ownsProject({ param: "projectId", requires: "quest:update" })],
    method: "POST",
    path: "/projects/:projectId/quests/:shortId/confirm-untrusted",
    schema: {
      params: z.object({ projectId: z.integer(), shortId: z.integer() }),
      response: z.object({
        untrustedConfirmedAt: z.string().optional(),
        untrustedConfirmedBy: z.uuid().optional(),
      }),
    },
    handler: async ({ params, user }) => {
      const quest = await this.service.confirm(
        params.projectId,
        params.shortId,
        user.id,
      );
      return {
        untrustedConfirmedAt: quest.untrustedConfirmedAt ?? undefined,
        untrustedConfirmedBy: quest.untrustedConfirmedBy ?? undefined,
      };
    },
  });
}
