import { $ownsProject, PromptRunService } from "@lore/core/api";
import { agentRunSchema } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";

/**
 * Review with an agent (#Q4214): an epic's Review prompt run as an agent job
 * on the project's Agent host, its key pinned to the epic. Starting it takes
 * `epic:write`, since the job writes back to the epic and its quests as the
 * member who started it, bounded by their rank.
 */
export class EpicAgentController {
  protected readonly runs = $inject(PromptRunService);

  reviewEpicWithAgent = $action({
    use: [$ownsProject({ param: "projectId", requires: "epic:write" })],
    method: "POST",
    path: "/projects/:projectId/epics/:number/agent-review",
    schema: {
      params: z.object({ projectId: z.integer(), number: z.integer() }),
      body: agentRunSchema.nullish(),
      response: z.object({ jobId: z.uuid() }),
    },
    // The `review-epic` prompt's run (#Q4275), until the page's pinned
    // button replaces this route.
    handler: async ({ params, body, user }) => ({
      jobId: (
        await this.runs.run(params.projectId, user, "review-epic", {
          args: { epic: String(params.number) },
          ...(body?.host ? { host: body.host } : {}),
          ...(body?.agent ? { agent: body.agent } : {}),
          ...(body?.model ? { model: body.model } : {}),
        })
      ).jobId,
    }),
  });
}
