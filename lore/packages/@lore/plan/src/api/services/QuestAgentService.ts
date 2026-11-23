import { AgentJobs, HostJobs } from "@lore/core/api";
import {
  type AgentRun,
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
 * Quest to branch (#Q3989): an accepted quest worked by an agent job with the
 * `push` profile on the project's Agent host, pushing `lore/q<n>` of the
 * project's Lore repository.
 *
 * The gates, each in code:
 * - only an **accepted** quest, not completed nor shelved: the human
 *   acceptance is what stands between untrusted text and code;
 * - an **untrusted** quest (born of feedback written outside the team) only
 *   once a member confirmed its text, recorded with who and when;
 * - the key writes `refs/heads/lore/q<n>` and below only, refused by
 *   receive-pack anywhere else, and reaches this quest's `quest_get`,
 *   `quest_objective_set`, `quest_comment_add` and `quest_commit_add`: no
 *   `quest_complete`, since a branch is not the default branch.
 *
 * The prompt is the project's `questWork` template first, rendered here,
 * under a fixed preamble that overrides it where they differ: the branch is
 * `lore/q<n>` pushed to Lore, there is no pull request yet and no quest
 * completion, and the run ends with a summary comment naming the branch.
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
      startedBy,
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
  ): Promise<string> {
    const [stored] = await this.prompts.findMany({
      where: { projectId: { eq: project.id }, kind: { eq: "questWork" } },
      limit: 1,
    });
    const template = stored?.template ?? questWorkPromptDefault;
    const slug = project.slug ?? String(project.id);
    const base = String(this.alepha.env.PUBLIC_URL ?? "");
    const reference = formatReference("quest", quest.shortId);
    const branch = `lore/q${quest.shortId}`;
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
      `## This run's rules, which override the procedure below where they differ`,
      "",
      `- You are in a fresh clone of the project's Lore repository, as an agent job on its Agent host. Follow the repository's AGENTS.md (or CLAUDE.md).`,
      `- Work on the branch \`${branch}\` (create it from the checked-out branch), and push only that branch to \`origin\`. Your key writes \`refs/heads/${branch}\` and below, and nothing else: a push anywhere else is refused.`,
      `- Commit as the project asks, each message naming ${reference}. Run the project's checks (\`yarn\`, then what AGENTS.md names, \`yarn v\` for this repository) and fix what is red before you push.`,
      "- Open no pull request, and do not complete the quest: a branch is not the default branch, and you hold no `quest_complete`. Tick the objectives you met with `quest_objective_set`, record your commit with `quest_commit_add`.",
      `- End with \`quest_comment_add\` on ${reference}: what you changed, what is left, and the branch \`${branch}\`.`,
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
