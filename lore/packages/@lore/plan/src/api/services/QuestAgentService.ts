import { AgentJobs, AgentRunPreamble, HostJobs } from "@lore/core/api";
import {
  type AgentRunRequest as AgentRun,
  projectPrompts,
  projects,
  renderPromptTemplate,
} from "@lore/core/schemas";
import { formatReference } from "@lore/core/web";
import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { BadRequestError, ForbiddenError, NotFoundError } from "alepha/server";

import { questWorkPromptDefault } from "../../web/app/prompts/questWorkPrompt.ts";
import { type Quest, quests } from "../entities/quests.ts";

/**
 * Build (#Q3989, light since #Q4224): an accepted quest worked by an agent job
 * on one of the project's Agent hosts, in its own workspace `q<n>`, removed
 * when the quest completes (#Q4218). The agent works with the host's own git
 * and `gh`: it branches, commits naming the quest, pushes and opens a pull
 * request, which it records on the quest.
 *
 * The gates, each in code:
 * - only an **accepted** quest, not completed nor shelved: the human
 *   acceptance is what stands between untrusted text and code;
 * - an **untrusted** quest (born of feedback written outside the team) only
 *   once a member confirmed its text, recorded with who and when;
 * - the key reaches Lore's MCP only, pinned to this quest.
 *
 * The prompt is Lore's preamble (the workspace, the repository, Lore through
 * its MCP tools), then fixed rules that override the project's `questWork`
 * template where they differ, then that template.
 */
export class QuestAgentService {
  /**
   * A quest's work time.
   */
  public static readonly WORK_SECONDS = 60 * 60;

  protected readonly alepha = $inject(Alepha);
  protected readonly rows = $repository(quests);
  protected readonly projects = $repository(projects);
  protected readonly prompts = $repository(projectPrompts);
  protected readonly agents = $inject(AgentJobs);
  protected readonly hostJobs = $inject(HostJobs);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Starts the push job on an accepted quest.
   */
  public async work(
    projectId: number,
    shortId: number,
    startedBy: string,
    run: AgentRun = {},
  ): Promise<{ jobId: string }> {
    const quest = await this.find(projectId, shortId);
    if (!quest.acceptedAt || quest.completedAt || quest.shelvedAt) {
      throw new BadRequestError(
        `Quest ${shortId} is not accepted and open: only an accepted quest is worked by an agent`,
      );
    }
    if (quest.untrusted && !quest.untrustedConfirmedAt) {
      throw new ForbiddenError(
        `Quest ${shortId} was born of feedback written outside the team: a member confirms its text before an agent works it`,
      );
    }
    await this.agents.resolve(projectId, run);
    const project = await this.projects.getOne({
      where: { id: { eq: projectId } },
    });
    const job = await this.agents.start({
      projectId,
      ...run,
      prompt: await this.prompt(project, quest),
      timeoutSeconds: QuestAgentService.WORK_SECONDS,
      questNumber: quest.shortId,
      // A build changes code: a worktree on `lore/q<n>` (#E173).
      defaultSource: "write",
      startedBy,
      subjectType: "quest",
      subjectId: String(quest.shortId),
    });
    return { jobId: job.id };
  }

  /**
   * A build automation's job on a todo quest (#Q4229): the quest the build
   * rule picked, accepted by the job itself as its first act, in its own
   * workspace. The automation's gates are its own (`PlanAutomationKinds`):
   * a `needs-human` quest, an untrusted one nobody confirmed, or one
   * already built never gets here.
   */
  public async build(
    projectId: number,
    quest: Quest,
    startedBy: string,
    run: AgentRun,
    origin: {
      automationId: string;
      startedByJobId?: string;
      autoMerge: boolean;
    },
  ): Promise<{ jobId: string }> {
    if (quest.untrusted && !quest.untrustedConfirmedAt) {
      throw new ForbiddenError(
        `Quest ${quest.shortId} was born of feedback written outside the team: a member confirms its text before an agent works it`,
      );
    }
    const project = await this.projects.getOne({
      where: { id: { eq: projectId } },
    });
    const job = await this.agents.start({
      projectId,
      ...run,
      prompt: await this.prompt(project, quest, {
        accept: true,
        autoMerge: origin.autoMerge,
      }),
      timeoutSeconds: QuestAgentService.WORK_SECONDS,
      questNumber: quest.shortId,
      defaultSource: "write",
      startedBy,
      automationId: origin.automationId,
      ...(origin.startedByJobId
        ? { startedByJobId: origin.startedByJobId }
        : {}),
      build: true,
      subjectType: "quest",
      subjectId: String(quest.shortId),
    });
    return { jobId: job.id };
  }

  /**
   * What a run may pick now (#Q4223): each available Agent host with each
   * agent it reports. Empty, the quest offers no agent button.
   */
  public async agentChoices(
    projectId: number,
  ): Promise<Array<{ host: string; agent?: string }>> {
    return this.agents.choices(projectId);
  }

  /**
   * A member confirms an untrusted quest's text: an agent may then work it.
   * Recorded once, with who and when.
   */
  public async confirm(
    projectId: number,
    shortId: number,
    userId: string,
  ): Promise<Quest> {
    const quest = await this.find(projectId, shortId);
    if (!quest.untrusted) {
      throw new BadRequestError(`Quest ${shortId} needs no confirmation`);
    }
    if (!quest.untrustedConfirmedAt) {
      await this.rows.updateById(quest.id, {
        untrustedConfirmedAt: new Date(this.dateTime.nowMillis()).toISOString(),
        untrustedConfirmedBy: userId,
      });
    }
    return this.find(projectId, shortId);
  }

  /**
   * The job's prompt: the fixed rules, then the project's `questWork`.
   */
  public async prompt(
    project: { id: number; title: string; slug?: string | null },
    quest: Quest,
    options: { accept?: boolean; autoMerge?: boolean } = {},
  ): Promise<string> {
    const [stored] = await this.prompts.findMany({
      where: { projectId: { eq: project.id }, kind: { eq: "questWork" } },
      limit: 1,
    });
    const template = stored?.template ?? questWorkPromptDefault;
    const slug = project.slug ?? String(project.id);
    const base = String(this.alepha.env.PUBLIC_URL ?? "");
    const reference = formatReference("quest", quest.shortId);
    const work = renderPromptTemplate(template, {
      project: project.title,
      slug,
      url: `${base}/${slug}/quests/${quest.shortId}`,
      number: quest.shortId,
      id: quest.id,
      reference,
      title: quest.title,
    });
    return [
      // Rendered when the job starts, once its source is settled (#E173).
      AgentRunPreamble.MARKER,
      "",
      `## This run's rules, which override the procedure below where they differ`,
      "",
      `- Follow the repository's own agent instructions (AGENTS.md or CLAUDE.md), the branch naming its convention gives included: Lore states none.`,
      ...(options.accept
        ? [
            `- Accept ${reference} first with \`quest_accept\`: a build automation picked it, and nobody holds it yet.`,
          ]
        : []),
      `- Do the work of ${reference}, then run the project's checks and fix what is red before you commit.`,
      `- Commit as the project asks, each message naming ${reference}: the merged commit naming it is what completes the quest later, so do not complete it yourself.`,
      options.autoMerge
        ? "- Push the branch and open a pull request with `gh`, then turn auto-merge on (`gh pr merge --auto`): the repository's own protections decide when it merges."
        : "- Push the branch and open a pull request with `gh`. Turn auto-merge on only when the repository's instructions ask for it.",
      `- Record the pull request on the quest with \`quest_pull_request_add\`, tick the objectives you met with \`quest_objective_set\`, and end with \`quest_comment_add\` on ${reference}: what you changed, what is left, and the pull request.`,
      "",
      work,
    ].join("\n");
  }

  protected async find(projectId: number, shortId: number): Promise<Quest> {
    const quest = await this.rows.findOne({
      where: { projectId: { eq: projectId }, shortId: { eq: shortId } },
    });
    if (!quest) {
      throw new NotFoundError(`No quest ${shortId} in this project`);
    }
    return quest;
  }
}
