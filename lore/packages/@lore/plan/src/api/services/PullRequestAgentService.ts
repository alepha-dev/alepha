import { AgentJobs, AgentRunPreamble } from "@lore/core/api";
import {
  type AgentRunRequest,
  projectPrompts,
  projects,
  renderPromptTemplate,
} from "@lore/core/schemas";
import { formatReference } from "@lore/core/web";
import { $inject, Alepha } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import { prReviewPromptDefault } from "../../web/app/prompts/prReviewPrompt.ts";

/**
 * A pull request reviewed by an agent job (#Q4251): a read job at
 * `pull/<n>/head`, or, for **review and fix**, a write job on the pull
 * request's own branch, which Bay asks GitHub for and refuses for a fork.
 *
 * Text from outside the team (#Q4216's rule): a pull request's diff and
 * description are its author's words, so the job carries
 * `trust: pr-author-writes` and Bay checks with the jobs user's `gh`, before
 * the agent starts, that the author can write to the repository. A member's
 * `trust` skips the check; an automation can never pass it
 * (`AgentJobService`).
 */
export class PullRequestAgentService {
  /**
   * A review's time on the host; a fix gets a build's.
   */
  public static readonly REVIEW_SECONDS = 30 * 60;
  public static readonly FIX_SECONDS = 2 * 3600;

  protected readonly alepha = $inject(Alepha);
  protected readonly agents = $inject(AgentJobs);
  protected readonly projects = $repository(projects);
  protected readonly prompts = $repository(projectPrompts);

  public async review(
    projectId: number,
    number: number,
    startedBy: string,
    run: AgentRunRequest = {},
    options: { fix?: boolean; trust?: boolean; questNumber?: number } = {},
  ): Promise<{ jobId: string }> {
    if (!Number.isInteger(number) || number < 1) {
      throw new BadRequestError(
        "A pull request is named by its number: --pr <n>",
      );
    }
    const project = await this.projects.findOne({
      where: { id: { eq: projectId } },
    });
    if (!project) throw new NotFoundError("No such project");
    const ref = `pull/${number}/head`;
    const job = await this.agents.start({
      projectId,
      ...(run.host ? { host: run.host } : {}),
      ...(run.agent ? { agent: run.agent } : {}),
      ...(run.model ? { model: run.model } : {}),
      prompt: await this.prompt(project, number, options.questNumber),
      source: {
        mode: options.fix ? "write" : "read",
        ref,
        ...(options.trust ? {} : { trust: "pr-author-writes" as const }),
      },
      workspace: `pr-${number}`,
      timeoutSeconds: options.fix
        ? PullRequestAgentService.FIX_SECONDS
        : PullRequestAgentService.REVIEW_SECONDS,
      ...(options.questNumber === undefined
        ? {}
        : { questNumber: options.questNumber }),
      startedBy,
      subjectType: "pull-request",
      subjectId: String(number),
    });
    return { jobId: job.id };
  }

  /**
   * The project's `prReview` prompt, or the default, under Lore's preamble.
   */
  public async prompt(
    project: {
      id: number;
      title: string;
      slug?: string | null;
      repositoryUrl?: string | null;
    },
    number: number,
    questNumber?: number,
  ): Promise<string> {
    const [stored] = await this.prompts.findMany({
      where: { projectId: { eq: project.id }, kind: { eq: "prReview" } },
      limit: 1,
    });
    const slug = project.slug ?? String(project.id);
    const repository = (project.repositoryUrl ?? "").replace(/\/+$/, "");
    const reference =
      questNumber === undefined
        ? `pull request #${number}`
        : formatReference("quest", questNumber);
    return [
      AgentRunPreamble.MARKER,
      "",
      renderPromptTemplate(stored?.template ?? prReviewPromptDefault, {
        project: project.title,
        slug,
        url: repository ? `${repository}/pull/${number}` : `#${number}`,
        number,
        id: number,
        reference,
        title: `pull request #${number}`,
      }),
    ].join("\n");
  }
}
