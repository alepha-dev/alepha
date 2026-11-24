import { $ownsProject } from "@lore/core/api";
import { appNameSchema } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { $action, NotFoundError } from "alepha/server";

import { commitPushSchema } from "../schemas/commitPushSchema.ts";
import { instanceLiveQuestsSchema } from "../schemas/instanceLiveQuestsSchema.ts";
import { knownCommitsResultSchema } from "../schemas/knownCommitsResultSchema.ts";
import { questLivenessSchema } from "../schemas/questLivenessSchema.ts";
import { CommitQuestSetService } from "../services/CommitQuestSetService.ts";
import { LiveQuestService } from "../services/LiveQuestService.ts";

/**
 * Live quests (#E154, folio #F1516): which deployed copy runs a quest's
 * commits.
 *
 * ⚠️ `findKnownCommits` is a wire contract like the artifact push:
 * `@alepha/lore/cli` reaches it by path before every push.
 */
export class LiveQuestController {
  protected readonly sets = $inject(CommitQuestSetService);
  protected readonly live = $inject(LiveQuestService);

  /**
   * Which of a pusher's newest commits already have a quest set, so it walks
   * only from the newest complete one. A POST because 200 shas are 8 KB: a
   * read all the same, gated like the push it precedes.
   */
  findKnownCommits = $action({
    use: [$ownsProject({ requires: "artifact:push", param: "projectId" })],
    method: "POST",
    path: "/projects/:projectId/artifacts/known-commits",
    description:
      "Which of these commits already have a quest set, newest first as sent.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        shas: z.array(z.string().regex(/^[0-9a-fA-F]{7,40}$/)).max(200),
        /**
         * Ask for one app's sets, walked with these paths (#Q3868): both or
         * neither. A set walked with other paths is not known.
         */
        app: appNameSchema.optional(),
        paths: z.string().min(1).max(2000).optional(),
      }),
      response: knownCommitsResultSchema,
    },
    handler: async ({ params, body }) => {
      if (body.app && body.paths) {
        return {
          known: await this.sets.known(params.projectId, body.shas, {
            app: body.app,
            paths: body.paths,
          }),
          app: body.app,
        };
      }
      return { known: await this.sets.known(params.projectId, body.shas) };
    },
  });

  /**
   * A bare commit push (#Q4234): the quest set of a commit, for a project
   * that does not deploy through Lore, sent by `lore commits push` from CI.
   * Kept like an artifact push's, and on the default branch it completes
   * the quests an automation built that the history names.
   */
  pushCommitQuests = $action({
    use: [$ownsProject({ requires: "artifact:push", param: "projectId" })],
    method: "POST",
    path: "/projects/:projectId/commits",
    description:
      "Record the quests a commit's history references, and complete the automation-built ones it lands on the default branch.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: commitPushSchema,
      response: z.object({
        count: z.integer(),
        complete: z.boolean(),
        /** Whether the commit was on the default branch. */
        landed: z.boolean(),
      }),
    },
    handler: async ({ params, body }) => {
      const set = await this.sets.record({
        projectId: params.projectId,
        commitSha: body.commitSha,
        base: body.quests.base,
        numbers: body.quests.numbers,
        walked: body.walked.map((sha) => sha.toLowerCase()),
        complete: body.quests.complete,
      });
      const landed = await this.sets.landed({
        projectId: params.projectId,
        commitSha: body.commitSha,
        branch: body.branch,
        defaultBranch: body.defaultBranch,
        numbers: set.numbers,
      });
      return { count: set.numbers.size, complete: set.complete, landed };
    },
  });

  /**
   * One copy's live set, what it is behind, and what each recent deployment
   * put live and took down.
   */
  getInstanceLiveQuests = $action({
    use: [$ownsProject({ requires: "app:read", param: "projectId" })],
    method: "GET",
    path: "/projects/:projectId/apps/:instanceId/live-quests",
    description:
      "The quests a deployed copy runs, and the done ones it does not.",
    schema: {
      params: z.object({ projectId: z.integer(), instanceId: z.uuid() }),
      response: instanceLiveQuestsSchema,
    },
    handler: async ({ params }) => {
      const detail = await this.live.instance(
        params.projectId,
        params.instanceId,
      );
      if (!detail) {
        throw new NotFoundError("No such deployed copy in this project.");
      }
      return {
        state: detail.state,
        ...(detail.reason ? { reason: detail.reason } : {}),
        ...(detail.deploymentId ? { deploymentId: detail.deploymentId } : {}),
        ...(detail.commitSha ? { commitSha: detail.commitSha } : {}),
        ...(detail.dirty === undefined ? {} : { dirty: detail.dirty }),
        ...(detail.live ? { live: detail.live } : {}),
        ...(detail.behind ? { behind: detail.behind } : {}),
        runs: detail.runs,
      };
    },
  });

  /**
   * The copies running one quest's commits.
   */
  getQuestLiveness = $action({
    use: [$ownsProject({ requires: "app:read", param: "projectId" })],
    method: "GET",
    path: "/projects/:projectId/live-quests/:number",
    description: "The deployed copies running a quest's commits.",
    schema: {
      params: z.object({ projectId: z.integer(), number: z.integer().min(1) }),
      response: questLivenessSchema,
    },
    handler: async ({ params }) =>
      await this.live.questLiveness(params.projectId, params.number),
  });
}
