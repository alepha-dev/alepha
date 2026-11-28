import { $inject, Alepha, z } from "alepha";
import { $action, ForbiddenError, NotFoundError } from "alepha/server";

import { pullRequestStateSchema } from "../schemas/pullRequestStateSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { JobKeyService } from "../services/JobKeyService.ts";
import { PullRequestStateService } from "../services/PullRequestStateService.ts";

/**
 * Pull requests' GitHub state, as Lore keeps it (#Q4367): read beside the
 * records a quest or an epic carries, never fetched from GitHub on read.
 */
export class PullRequestController {
  protected readonly alepha = $inject(Alepha);
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

  /**
   * A member trusts a pull request from outside the team (#Q4368): stored,
   * with `pull_request.trusted`, which fires the prompt triggers waiting on
   * it. Idempotent.
   */
  trustPullRequest = $action({
    use: [$ownsProject({ param: "projectId", requires: "quest:update" })],
    method: "POST",
    path: "/projects/:projectId/pull-requests/:number/trust",
    description:
      "Trust a pull request from outside the team, so prompt triggers act on it",
    schema: {
      params: z.object({ projectId: z.integer(), number: z.integer() }),
      response: pullRequestStateSchema,
    },
    handler: async ({ params, user }) => {
      // Trust is a person's read of a stranger's text: an agent job, which
      // may have read that text, never gives it (#Q4368).
      const keys = this.alepha.inject(JobKeyService);
      const key =
        (await keys.scopeOf(user).catch(() => undefined)) ??
        (await keys.current().catch(() => undefined));
      if (key) {
        throw new ForbiddenError(
          "An agent job cannot trust a pull request: a member does it",
        );
      }
      const row = await this.states.ofProject(params.projectId, {
        numbers: [params.number],
      });
      const target = row[0];
      if (!target) {
        throw new NotFoundError(
          `No pull request #${params.number} is known for this project's repository`,
        );
      }
      return this.states.stateOf(await this.states.trust(target, user!.id));
    },
  });
}
