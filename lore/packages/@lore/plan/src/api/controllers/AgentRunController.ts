import {
  $ownsProject,
  AgentJobs,
  ProjectSecurityService,
} from "@lore/core/api";
import { agentRunSchema, agentRunSourceSchema } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { $action, BadRequestError, ForbiddenError } from "alepha/server";

import { DependencyAgentService } from "../services/DependencyAgentService.ts";
import { FeedbackAgentService } from "../services/FeedbackAgentService.ts";
import { PullRequestAgentService } from "../services/PullRequestAgentService.ts";
import { QuestAgentService } from "../services/QuestAgentService.ts";

/**
 * Run a prompt on an Agent host (#Q4225): what `lore agent run` and
 * `agent_run` call, so a member drives Lore's agent jobs from their own
 * coding agent.
 *
 * - `triage`: the project's Triage prompt over the inbox and the open errors
 *   (`feedbackLoop`, the same run as the robot menu's), under
 *   `feedback:triage`;
 * - `build`: the Build prompt on one accepted quest (`questWork`), under
 *   `quest:update`;
 * - `security-check` (`quest:create`) and `dependency-update`
 *   (`quest:update`, `text` naming the packages): the dependencies (#Q4252);
 * - `review-pr`: the Review prompt on a pull request (#Q4251), under
 *   `quest:update`: a read job at its head, or `fix` to push to its branch;
 * - `text`: a free prompt the member writes, under `host:update`, since it
 *   asks the host for anything their rank allows. Read-only by default
 *   since #E173: a text run that changes code asks for `source: "write"`.
 *
 * `source` and `ref` override a run's default source (#Q4248): a triage
 * reads, a build writes, every read at the default branch.
 *
 * A request made with a job key records that key's job as the parent, and a
 * chain never holds two agent jobs (#Q4222): an agent cannot start a job.
 */
export class AgentRunController {
  protected readonly feedbackAgent = $inject(FeedbackAgentService);
  protected readonly questAgent = $inject(QuestAgentService);
  protected readonly prAgent = $inject(PullRequestAgentService);
  protected readonly dependencyAgent = $inject(DependencyAgentService);
  protected readonly agents = $inject(AgentJobs);
  protected readonly security = $inject(ProjectSecurityService);

  runAgent = $action({
    use: [$ownsProject({ param: "projectId", requires: "host:read" })],
    method: "POST",
    path: "/projects/:projectId/agent-run",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: agentRunSchema.merge(agentRunSourceSchema).extend({
        prompt: z.enum([
          "triage",
          "build",
          "text",
          "review-pr",
          "security-check",
          "dependency-update",
        ]),
        /** The quest a `build` works, or the one a `review-pr` is about. */
        quest: z.integer().optional(),
        /** The pull request a `review-pr` reviews, by its number (#Q4251). */
        pr: z.integer().min(1).optional(),
        /** A `review-pr` that pushes its fixes to the pull request's branch. */
        fix: z.boolean().optional(),
        /**
         * A member trusts the pull request's author: Bay does not check that
         * they can write to the repository. Never an automation's.
         */
        trust: z.boolean().optional(),
        /**
         * A `text` prompt's words, or the packages a `dependency-update`
         * updates.
         */
        text: z.string().max(131_072).optional(),
        /** The workspace a `text` prompt runs in; `text` by default. */
        workspace: z
          .string()
          .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/)
          .optional(),
        /** A `text` prompt's time, in seconds. */
        timeout: z.integer().min(60).max(7200).optional(),
      }),
      response: z.object({
        jobId: z.uuid().optional(),
        /** Feedback items a triage left out for want of a member's trust. */
        skipped: z.array(z.integer()),
      }),
    },
    handler: async ({ params, body, user }) => {
      const run = {
        ...(body.host ? { host: body.host } : {}),
        ...(body.agent ? { agent: body.agent } : {}),
        ...(body.model ? { model: body.model } : {}),
        ...(body.source
          ? {
              source: {
                mode: body.source,
                ...(body.ref ? { ref: body.ref } : {}),
              },
            }
          : body.ref
            ? { source: { mode: "read" as const, ref: body.ref } }
            : {}),
      };
      const need = async (permission: string) => {
        if (
          !(await this.security.holds(params.projectId, user.id, permission))
        ) {
          throw new ForbiddenError(
            `A ${body.prompt} run needs the ${permission} permission`,
          );
        }
      };
      if (body.prompt === "triage") {
        await need("feedback:triage");
        const out = await this.feedbackAgent.triageInbox(
          params.projectId,
          user.id,
          run,
        );
        return {
          ...(out.global ? { jobId: out.global } : {}),
          skipped: out.skipped,
        };
      }
      if (body.prompt === "build") {
        await need("quest:update");
        if (body.quest === undefined) {
          throw new BadRequestError("A build names its quest: --quest <n>");
        }
        const out = await this.questAgent.work(
          params.projectId,
          body.quest,
          user.id,
          run,
        );
        return { jobId: out.jobId, skipped: [] };
      }
      if (body.prompt === "security-check") {
        // It files quests (#Q4252).
        await need("quest:create");
        const out = await this.dependencyAgent.securityCheck(
          params.projectId,
          user.id,
          run,
        );
        return { jobId: out.jobId, skipped: [] };
      }
      if (body.prompt === "dependency-update") {
        // It opens a pull request, as a build does (#Q4252).
        await need("quest:update");
        const out = await this.dependencyAgent.dependencyUpdate(
          params.projectId,
          user.id,
          run,
          {},
          body.text,
        );
        return { jobId: out.jobId, skipped: [] };
      }
      if (body.prompt === "review-pr") {
        await need("quest:update");
        if (body.pr === undefined) {
          throw new BadRequestError(
            "A review-pr names its pull request: --pr <n>",
          );
        }
        const out = await this.prAgent.review(
          params.projectId,
          body.pr,
          user.id,
          run,
          {
            ...(body.fix ? { fix: true } : {}),
            ...(body.trust ? { trust: true } : {}),
            ...(body.quest === undefined ? {} : { questNumber: body.quest }),
          },
        );
        return { jobId: out.jobId, skipped: [] };
      }
      await need("host:update");
      if (!body.text?.trim()) {
        throw new BadRequestError("A text prompt carries its words: --text");
      }
      const workspace = body.workspace ?? "text";
      const job = await this.agents.start({
        projectId: params.projectId,
        ...run,
        // Lore's preamble goes above the member's words when the job starts.
        prompt: body.text,
        workspace,
        ...(body.timeout ? { timeoutSeconds: body.timeout } : {}),
        startedBy: user.id,
        subjectType: "prompt",
        subjectId: workspace,
      });
      return { jobId: job.id, skipped: [] };
    },
  });
}
