import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { QuestAgentService } from "../services/QuestAgentService.ts";

/**
 * The confirmation an untrusted quest needs before an agent works it
 * (#Q3989). The job itself is the `work-quest` prompt's run (#Q4275); the
 * button that started it from the quest went with #Q4281.
 */
export class QuestAgentController {
  protected readonly service = $inject(QuestAgentService);

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
