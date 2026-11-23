import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { QuestAgentService } from "../services/QuestAgentService.ts";

/**
 * Work it with Claude (#Q3989): an accepted quest worked by an agent job
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
      response: z.object({ jobId: z.uuid() }),
    },
    handler: async ({ params, user }) =>
      this.service.work(params.projectId, params.shortId, user.id),
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
