import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { pullRequestStateSchema } from "../schemas/pullRequestStateSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { PullRequestStateService } from "../services/PullRequestStateService.ts";

/**
 * Pull requests' GitHub state, as Lore keeps it (#Q4367): read beside the
 * records a quest or an epic carries, never fetched from GitHub on read.
 */
export class PullRequestController {
  protected readonly states = $inject(PullRequestStateService);

  getPullRequestStates = $action({
    use: [$ownsProject({ param: "projectId", requires: "project:read" })],
    method: "POST",
    path: "/projects/:projectId/pull-requests/states",
    description:
      "The GitHub state of pull requests a quest or an epic records, by URL: open, draft, merged or closed, checks and review. A URL of another repository, or of an unconnected project, answers nothing",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({ urls: z.array(z.string().max(500)).max(50) }),
      response: z.object({ items: z.array(pullRequestStateSchema) }),
    },
    handler: async ({ params, body }) => ({
      items: await this.states.statesFor(params.projectId, body.urls),
    }),
  });
}
