import {
  AgentJobs,
  AgentRunPreamble,
  HostJobs,
  JobKeyService,
} from "@lore/core/api";
import {
  type AgentRun,
  projectPrompts,
  projects,
  renderPromptTemplate,
} from "@lore/core/schemas";
import { formatReference } from "@lore/core/web";
import { $inject, Alepha } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError, ForbiddenError, NotFoundError } from "alepha/server";

import { epicReviewPromptDefault } from "../../web/app/prompts/epicReviewPrompt.ts";
import { type Epic, epics } from "../entities/epics.ts";
import { quests } from "../entities/quests.ts";

/**
 * Review with an agent (#Q4214): an epic's Review prompt run as an agent job
 * on the project's Agent host, instead of being pasted into a session.
 *
 * Its key is pinned to the epic (`job_keys.epic_number`, checked by
 * `JobKeyService`): `epic_*` tools reach this epic only, `quest_create` and
 * `folio_create` file under it, and `quest_get`, `quest_update` and
 * `quest_objective_set` touch its quests only. Its starter's rank bounds the
 * rest (#Q4222: no tool allowlist).
 *
 * **Untrusted quests (the decision).** An epic may hold a quest born of
 * feedback written outside the team whose text no member confirmed. Such a
 * review is refused, saying which quests to confirm (#Q4222: no runner
 * isolates outside text any more). Not "keep those quests out of reach": a
 * review that cannot read part of its epic reviews a different plan than
 * the owner's, silently.
 *
 * The prompt is the project's `epicReview` template, else the default,
 * rendered here under a fixed preamble: nobody reads the job's chat, so the
 * filed review is the report and the final message a short summary.
 */
export class EpicAgentService {
  /**
   * The job's subject, with the epic's number as its id.
   */
  public static readonly SUBJECT = "epic";

  /**
   * The review's time: a base, plus this much per quest of the epic. Agent
   * jobs clamp it to their ceiling.
   */
  public static readonly TIME = {
    baseSeconds: 15 * 60,
    secondsPerQuest: 90,
  };

  protected readonly alepha = $inject(Alepha);
  protected readonly epics = $repository(epics);
  protected readonly quests = $repository(quests);
  protected readonly projects = $repository(projects);
  protected readonly prompts = $repository(projectPrompts);
  protected readonly agents = $inject(AgentJobs);
  protected readonly preamble = $inject(AgentRunPreamble);
  protected readonly hostJobs = $inject(HostJobs);
  protected readonly keys = $inject(JobKeyService);

  constructor() {
    this.keys.registerEpicMembership((projectId, epicNumber, quest) =>
      this.inEpic(projectId, epicNumber, quest),
    );
  }

  /**
   * Starts the review job on an epic whose plan is open.
   */
  public async review(
    projectId: number,
    number: number,
    startedBy: string,
    run: AgentRun = {},
  ): Promise<{ jobId: string }> {
    const epic = await this.find(projectId, number);
    if (epic.status !== "draft" && epic.status !== "ready") {
      throw new BadRequestError(
        `Epic ${number} is ${epic.status}: only a draft or ready epic is reviewed`,
      );
    }
    await this.agents.resolve(projectId, run);
    const active = await this.hostJobs.active(
      projectId,
      EpicAgentService.SUBJECT,
      String(number),
    );
    if (active) {
      throw new BadRequestError(
        `A review of epic ${number} is already ${active.status}`,
      );
    }
    const members = await this.quests.findMany({
      where: { projectId: { eq: projectId }, epicId: { eq: epic.id } },
    });
    const unconfirmed = members.filter(
      (it) => it.untrusted && !it.untrustedConfirmedAt && !it.deletedAt,
    );
    if (unconfirmed.length) {
      throw new ForbiddenError(
        `Epic ${number} holds quests born of feedback written outside the team (${unconfirmed
          .map((it) => formatReference("quest", it.shortId))
          .join(", ")}): a member confirms their text first`,
      );
    }
    const project = await this.projects.getOne({
      where: { id: { eq: projectId } },
    });
    const t = EpicAgentService.TIME;
    const job = await this.agents.start({
      projectId,
      ...run,
      prompt: await this.prompt(project, epic),
      timeoutSeconds: t.baseSeconds + t.secondsPerQuest * members.length,
      epicNumber: epic.number,
      startedBy,
      subjectType: EpicAgentService.SUBJECT,
      subjectId: String(epic.number),
    });
    await this.epics.updateById(epic.id, { agentReviewJobId: job.id });
    return { jobId: job.id };
  }

  /**
   * What a run may pick now (#Q4223): each available Agent host with each
   * agent it reports. Empty, the robot menu offers no agent entry.
   */
  public async agentChoices(
    projectId: number,
  ): Promise<Array<{ host: string; agent?: string }>> {
    return this.agents.choices(projectId);
  }

  /**
   * The job's prompt: the fixed rules, then the project's `epicReview`.
   */
  public async prompt(
    project: { id: number; title: string; slug?: string | null },
    epic: Epic,
  ): Promise<string> {
    const [stored] = await this.prompts.findMany({
      where: { projectId: { eq: project.id }, kind: { eq: "epicReview" } },
      limit: 1,
    });
    const template = stored?.template ?? epicReviewPromptDefault;
    const slug = project.slug ?? String(project.id);
    const base = String(this.alepha.env.PUBLIC_URL ?? "");
    const reference = formatReference("epic", epic.number);
    const review = renderPromptTemplate(template, {
      project: project.title,
      slug,
      url: `${base}/${slug}/epics/${epic.number}`,
      number: epic.number,
      id: epic.id,
      reference,
      title: epic.title,
    });
    return [
      await this.preamble.render(project.id, false),
      "",
      `## This run's rules, which override the procedure below where they differ`,
      "",
      `- Read the code to check the plan against it. Do not create branches, commit or push.`,
      `- Your Lore key reaches ${reference} and its quests only: \`epic_*\` tools on epic ${epic.number}, \`quest_create\` and \`folio_create\` with \`epic_number\` ${epic.number}, quest writes on its own quests. You do not answer the review: the owner does.`,
      `- Nobody reads this run's chat. The review you file with \`epic_review_create\` is the report: put every question's context, suggestions and recommendation there, not in your reply. End with a short summary naming the review's item numbers and anything you changed.`,
      "",
      review,
    ].join("\n");
  }

  /**
   * Whether a quest is filed under an epic: the job key's pin reads it.
   */
  protected async inEpic(
    projectId: number,
    epicNumber: number,
    quest: { shortId?: number; id?: number },
  ): Promise<boolean> {
    const epic = await this.epics.findOne({
      where: { projectId: { eq: projectId }, number: { eq: epicNumber } },
    });
    if (!epic) return false;
    const row = await this.quests.findOne({
      where: {
        projectId: { eq: projectId },
        ...(quest.shortId !== undefined
          ? { shortId: { eq: quest.shortId } }
          : { id: { eq: quest.id as number } }),
      },
    });
    return row?.epicId === epic.id;
  }

  protected async find(projectId: number, number: number): Promise<Epic> {
    const epic = await this.epics.findOne({
      where: { projectId: { eq: projectId }, number: { eq: number } },
    });
    if (!epic) {
      throw new NotFoundError(`No epic ${number} in this project`);
    }
    return epic;
  }
}
