import {
  AgentJobs,
  type PromptArgContext,
  PromptRegistry,
  type PromptRunContext,
  type PromptRunPlan,
} from "@lore/core/api";
import { PROMPT_NEEDS_HUMAN_TAG } from "@lore/core/schemas";
import { formatReference } from "@lore/core/web";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError, ForbiddenError } from "alepha/server";

import { epics } from "../entities/epics.ts";
import { feedback } from "../entities/feedback.ts";
import { quests } from "../entities/quests.ts";
import { dependencyUpdatePromptText } from "../prompts/dependencyUpdatePrompt.ts";
import { reviewEpicPromptText } from "../prompts/reviewEpicPrompt.ts";
import { reviewPrPromptText } from "../prompts/reviewPrPrompt.ts";
import { securityCheckPromptText } from "../prompts/securityCheckPrompt.ts";
import { triagePromptText } from "../prompts/triagePrompt.ts";
import { weeklyStatusPromptText } from "../prompts/weeklyStatusPrompt.ts";
import { workEpicPromptText } from "../prompts/workEpicPrompt.ts";
import { workFeedbackPromptText } from "../prompts/workFeedbackPrompt.ts";
import { workLooseQuestsPromptText } from "../prompts/workLooseQuestsPrompt.ts";
import { workQuestPromptText } from "../prompts/workQuestPrompt.ts";
import { EpicAgentService } from "./EpicAgentService.ts";
import { FeedbackAgentService } from "./FeedbackAgentService.ts";
import { PullRequestAgentService } from "./PullRequestAgentService.ts";
import { QuestResourceMapper } from "./QuestResourceMapper.ts";

/**
 * Plan's built-in prompts and the items its args name (#E174, #Q4274).
 *
 * The ten built-ins of the epic, each with its args and the statuses they
 * accept (the rule each page hard-coded before), its source, the permission
 * a run needs, its timeout and what the project needs to use it. Their words
 * live in `api/prompts/`, the one place a change to them goes.
 *
 * The epic, quest and feedback args read their item by its number, a member
 * reading it with their own permission.
 */
export class PlanPrompts {
  protected readonly registry = $inject(PromptRegistry);
  protected readonly epics = $repository(epics);
  protected readonly quests = $repository(quests);
  protected readonly feedback = $repository(feedback);
  protected readonly mapper = $inject(QuestResourceMapper);
  protected readonly feedbackAgent = $inject(FeedbackAgentService);

  constructor() {
    const epicsOption = { capability: "plan", option: "epics" } as const;
    const feedbackOption = { capability: "plan", option: "feedback" } as const;
    this.registry.register({
      name: "review-epic",
      title: "Review Epic",
      description:
        "Review an epic's plan before it starts: take the open decisions, sharpen the quests, and file the questions for the owner.",
      args: [{ name: "epic", type: "epic", accepts: ["draft", "ready"] }],
      source: "read",
      permission: "epic:write",
      timeoutSeconds: 30 * 60,
      pins: ["epic"],
      needs: epicsOption,
      text: reviewEpicPromptText,
      prepare: (context) => this.prepareReviewEpic(context),
      oneShot: true,
    });
    this.registry.register({
      name: "work-epic",
      title: "Work on epic",
      description:
        "Work an epic to completion, quest by quest, in one pull request.",
      args: [{ name: "epic", type: "epic", accepts: ["ready", "in_progress"] }],
      source: "write",
      permission: "quest:update",
      // 4 h, the most nfo1's Bay accepts until it runs the 12 h one (#Q4328).
      timeoutSeconds: 4 * 60 * 60,
      pins: ["epic"],
      needs: epicsOption,
      text: workEpicPromptText,
      prepare: (context) => this.prepareWorkEpic(context),
      oneShot: true,
    });
    this.registry.register({
      name: "work-quest",
      title: "Work on quest",
      description: "Work one quest into a pull request.",
      args: [
        { name: "quest", type: "quest", accepts: ["todo", "in_progress"] },
      ],
      source: "write",
      permission: "quest:update",
      timeoutSeconds: 60 * 60,
      pins: ["quest"],
      text: workQuestPromptText,
      prepare: (context) => this.prepareWorkQuest(context),
      oneShot: true,
    });
    this.registry.register({
      name: "work-feedback",
      title: "Work on feedback",
      description:
        "Turn a feedback item into a quest and work it into a pull request.",
      args: [
        {
          name: "feedback",
          type: "feedback",
          accepts: ["pending", "accepted"],
        },
      ],
      source: "write",
      permission: "quest:update",
      timeoutSeconds: 60 * 60,
      pins: ["feedback-item"],
      needs: feedbackOption,
      text: workFeedbackPromptText,
      prepare: (context) => this.prepareWorkFeedback(context),
      oneShot: true,
    });
    this.registry.register({
      name: "triage",
      title: "Triage feedback and errors",
      description:
        "Triage the feedback inbox and the open errors: a quest per real problem.",
      args: [],
      source: "read",
      permission: "feedback:triage",
      timeoutSeconds: 60 * 60,
      // Each run reads the whole inbox: one asked for meanwhile waits.
      concurrency: "queue",
      pins: ["feedback"],
      needs: feedbackOption,
      text: triagePromptText,
      prepare: (context) => this.prepareTriage(context),
      oneShot: true,
    });
    this.registry.register({
      name: "work-loose-quests",
      title: "Work on loose quests",
      description:
        "Work every quest under no epic, one pull request for the run.",
      args: [],
      source: "write",
      permission: "quest:update",
      // 4 h, the most nfo1's Bay accepts until it runs the 12 h one (#Q4328).
      timeoutSeconds: 4 * 60 * 60,
      // Each run reads every loose quest: one asked for meanwhile waits.
      concurrency: "queue",
      pins: ["quests"],
      text: workLooseQuestsPromptText,
      oneShot: true,
    });
    this.registry.register({
      name: "weekly-status",
      title: "Weekly status",
      description:
        "Write the week's status from the project's reports, changing nothing, and email it to a member.",
      args: [{ name: "member", type: "member" }],
      source: "none",
      permission: "host:read",
      timeoutSeconds: 30 * 60,
      text: weeklyStatusPromptText,
      prepare: async () => ({ workspace: "status" }),
      oneShot: true,
    });
    this.registry.register({
      name: "review-pr",
      title: "Review PR",
      description:
        "Review a pull request of the project's repository and post the review on it.",
      args: [{ name: "pullRequest", type: "pullRequest" }],
      source: "read",
      permission: "quest:update",
      timeoutSeconds: 30 * 60,
      text: reviewPrPromptText,
      prepare: async (context) => this.prepareReviewPr(context),
      oneShot: true,
    });
    this.registry.register({
      name: "security-check",
      title: "Security check",
      description:
        "Audit the dependencies and file a quest per real vulnerability.",
      args: [],
      source: "read",
      permission: "quest:create",
      timeoutSeconds: 30 * 60,
      text: securityCheckPromptText,
      prepare: async () => ({ workspace: "security" }),
      oneShot: true,
    });
    this.registry.register({
      name: "dependency-update",
      title: "Dependency update",
      description:
        "Update the dependencies a minor or a patch behind into a pull request.",
      args: [],
      source: "write",
      permission: "quest:update",
      timeoutSeconds: 2 * 60 * 60,
      text: dependencyUpdatePromptText,
      oneShot: true,
    });

    this.registry.registerArg({
      type: "epic",
      permission: "epic:read",
      resolve: (context) => this.epicOf(context),
    });
    this.registry.registerArg({
      type: "quest",
      permission: "quest:read",
      resolve: (context) => this.questOf(context),
      // An event never fills a quest arg with a quest an agent should not
      // work alone, nor one born of outside text nobody confirmed (#Q4277).
      triggerRefusal: async (projectId, value) => {
        const quest = await this.quests.findOne({
          where: {
            projectId: { eq: projectId },
            shortId: { eq: this.numberOf(value) ?? 0 },
          },
        });
        if (!quest) return undefined;
        const reference = formatReference("quest", quest.shortId);
        if ((quest.tags ?? []).includes(PROMPT_NEEDS_HUMAN_TAG)) {
          return `${reference} is tagged ${PROMPT_NEEDS_HUMAN_TAG}: no trigger works it`;
        }
        if (quest.untrusted && !quest.untrustedConfirmedAt) {
          return `${reference} was born of feedback written outside the team: a member confirms its text first`;
        }
        return undefined;
      },
    });
    this.registry.registerArg({
      type: "feedback",
      permission: "feedback:read",
      resolve: (context) => this.feedbackOf(context),
      triggerRefusal: async (projectId, value) => {
        const item = await this.feedback.findOne({
          where: {
            projectId: { eq: projectId },
            shortId: { eq: this.numberOf(value) ?? 0 },
          },
        });
        return item && FeedbackAgentService.awaitsTrust(item)
          ? `${formatReference("feedback", item.shortId)} was written outside the team and no member has trusted it`
          : undefined;
      },
    });

    // What an arg's select lists (#Q4280), among the statuses it accepts.
    // The pages a prompt can be pinned to (#Q4284). A feedback item's view
    // is the detail panel of the feedback list: it has no route of its own.
    for (const page of [
      { key: "quests", label: "Quest list" },
      { key: "quest", label: "Quest view", gives: "quest" },
      { key: "epics", label: "Epic list" },
      { key: "epic", label: "Epic view", gives: "epic" },
      { key: "feedback", label: "Feedback list" },
      { key: "feedback-item", label: "Feedback view", gives: "feedback" },
    ] as const) {
      this.registry.registerPage(page);
    }
    this.registry.registerOptions("epic", (projectId, accepts) =>
      this.epicOptions(projectId, accepts),
    );
    this.registry.registerOptions("quest", (projectId, accepts) =>
      this.questOptions(projectId, accepts),
    );
    this.registry.registerOptions("feedback", (projectId, accepts) =>
      this.feedbackOptions(projectId, accepts),
    );
    this.registry.registerOptions("pullRequest", (projectId) =>
      this.pullRequestOptions(projectId),
    );

    // What a triggered run's `check` asks (#Q4277): Plan's three sources.
    this.registry.registerCheck("feedback", (projectId) =>
      this.pendingFeedback(projectId),
    );
    this.registry.registerCheck("quests", (projectId) =>
      this.looseQuests(projectId),
    );
    this.registry.registerCheck("epics", (projectId) =>
      this.workableEpics(projectId),
    );
  }

  /**
   * The newest epics an arg may take.
   */
  protected async epicOptions(projectId: number, accepts?: string[]) {
    const rows = await this.epics.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "number", direction: "desc" }],
      limit: 200,
    });
    return rows
      .filter(
        (it) =>
          !it.deletedAt && (!accepts?.length || accepts.includes(it.status)),
      )
      .map((it) => ({
        value: String(it.number),
        label: `${formatReference("epic", it.number)} ${it.title}`,
      }));
  }

  /**
   * The newest quests an arg may take, never a shelved one.
   */
  protected async questOptions(projectId: number, accepts?: string[]) {
    const rows = await this.quests.findMany({
      where: { projectId: { eq: projectId }, shelvedAt: { isNull: true } },
      orderBy: [{ column: "shortId", direction: "desc" }],
      limit: 300,
    });
    return rows
      .filter((it) => {
        const status = this.mapper.questStatus(it);
        return !accepts?.length || accepts.includes(status);
      })
      .slice(0, 200)
      .map((it) => ({
        value: String(it.shortId),
        label: `${formatReference("quest", it.shortId)} ${it.title}`,
      }));
  }

  /**
   * The newest feedback items an arg may take.
   */
  protected async feedbackOptions(projectId: number, accepts?: string[]) {
    const rows = await this.feedback.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "shortId", direction: "desc" }],
      limit: 200,
    });
    return rows
      .filter((it) => !accepts?.length || accepts.includes(it.status))
      .map((it) => ({
        value: String(it.shortId),
        label: `${formatReference("feedback", it.shortId)} ${it.title}`,
      }));
  }

  /**
   * The pull requests recorded on the project's quests and epics, newest
   * number first.
   */
  protected async pullRequestOptions(projectId: number) {
    const [quests, epics] = await Promise.all([
      this.quests.findMany({
        where: {
          projectId: { eq: projectId },
          pullRequests: { isNotNull: true },
        },
        limit: 500,
      }),
      this.epics.findMany({
        where: {
          projectId: { eq: projectId },
          pullRequests: { isNotNull: true },
        },
        limit: 200,
      }),
    ]);
    const seen = new Map<number, string>();
    for (const row of [...quests, ...epics]) {
      for (const pr of row.pullRequests ?? []) {
        const number = Number(/\/pull\/(\d+)/.exec(pr.url)?.[1] ?? 0);
        if (number && !seen.has(number)) {
          seen.set(number, `#${number} ${pr.title ?? row.title}`);
        }
      }
    }
    return [...seen.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([number, label]) => ({ value: String(number), label }));
  }

  /**
   * A pending feedback item an agent may read: written by the team, or
   * trusted by a member.
   */
  public async pendingFeedback(projectId: number): Promise<boolean> {
    const pending = await this.feedback.findMany({
      where: { projectId: { eq: projectId }, status: { eq: "pending" } },
      limit: 200,
    });
    return pending.some((item) => !FeedbackAgentService.awaitsTrust(item));
  }

  /**
   * A loose quest to do, not on hold, that a job key can read and an agent
   * may work alone: what `work-loose-quests` takes.
   */
  public async looseQuests(projectId: number): Promise<boolean> {
    const candidates = await this.quests.findMany({
      where: {
        projectId: { eq: projectId },
        epicId: { isNull: true },
        acceptedAt: { isNull: true },
        completedAt: { isNull: true },
        shelvedAt: { isNull: true },
        heldAt: { isNull: true },
      },
      limit: 200,
    });
    return candidates.some(
      (quest) =>
        !(quest.tags ?? []).includes(PROMPT_NEEDS_HUMAN_TAG) &&
        !(quest.untrusted && !quest.untrustedConfirmedAt),
    );
  }

  /**
   * An epic ready or in progress that holds a quest to do.
   */
  public async workableEpics(projectId: number): Promise<boolean> {
    const open = await this.epics.findMany({
      where: {
        projectId: { eq: projectId },
        status: { inArray: ["ready", "in_progress"] },
      },
      limit: 100,
    });
    if (!open.length) return false;
    const todo = await this.quests.findOne({
      where: {
        projectId: { eq: projectId },
        epicId: { inArray: open.map((epic) => epic.id) },
        acceptedAt: { isNull: true },
        completedAt: { isNull: true },
        shelvedAt: { isNull: true },
      },
    });
    return Boolean(todo);
  }

  /**
   * The number an arg of the run resolved to.
   */
  protected numberIn(context: PromptRunContext, name: string): number {
    const found = context.items.find((it) => it.arg.name === name);
    return Number(found?.item.fields.number);
  }

  /**
   * An epic's quests born of outside text nobody confirmed: a review or a
   * work of the epic is refused until a member confirms them.
   */
  protected async assertEpicTrusted(projectId: number, number: number) {
    const epic = await this.epics.findOne({
      where: { projectId: { eq: projectId }, number: { eq: number } },
    });
    if (!epic) return { quests: 0 };
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
    return { quests: members.length, id: epic.id };
  }

  /**
   * `review-epic`: the key pinned to the epic, a workspace of its own, a
   * time growing with its quests, and the review's fixed rules above the
   * text (#Q4214).
   */
  protected async prepareReviewEpic(
    context: PromptRunContext,
  ): Promise<PromptRunPlan> {
    const number = this.numberIn(context, "epic");
    const epic = await this.assertEpicTrusted(context.projectId, number);
    const t = EpicAgentService.TIME;
    const reference = formatReference("epic", number);
    return {
      prompt: [
        AgentJobs.PREAMBLE_MARKER,
        "",
        `## This run's rules, which override the procedure below where they differ`,
        "",
        `- Read the code to check the plan against it. Do not create branches, commit or push.`,
        `- Your Lore key reaches ${reference} and its quests only: \`epic_*\` tools on epic ${number}, \`quest_create\` and \`folio_create\` with \`epic_number\` ${number}, quest writes on its own quests. You do not answer the review: the owner does.`,
        `- Nobody reads this run's conversation. The review you file with \`epic_review_create\` is the report: put every question's context, suggestions and recommendation there. End with a short summary naming the review's item numbers and anything you changed.`,
        "",
        context.text,
      ].join("\n"),
      epicNumber: number,
      workspace: "review",
      timeoutSeconds: t.baseSeconds + t.secondsPerQuest * epic.quests,
      after: async (jobId) => {
        if (epic.id) {
          await this.epics.updateById(epic.id, { agentReviewJobId: jobId });
        }
      },
    };
  }

  /**
   * `work-epic`: the key pinned to the epic; refused while it holds a quest
   * born of outside text nobody confirmed.
   */
  protected async prepareWorkEpic(
    context: PromptRunContext,
  ): Promise<PromptRunPlan> {
    const number = this.numberIn(context, "epic");
    await this.assertEpicTrusted(context.projectId, number);
    return { epicNumber: number };
  }

  /**
   * `work-quest`: the key pinned to the quest, its workspace `q<n>` and its
   * branch `lore/q<n>`; refused on a quest born of outside text nobody
   * confirmed.
   */
  protected async prepareWorkQuest(
    context: PromptRunContext,
  ): Promise<PromptRunPlan> {
    const number = this.numberIn(context, "quest");
    const quest = await this.quests.findOne({
      where: {
        projectId: { eq: context.projectId },
        shortId: { eq: number },
      },
    });
    if (quest?.untrusted && !quest.untrustedConfirmedAt) {
      throw new ForbiddenError(
        `Quest ${number} was born of feedback written outside the team: a member confirms its text before an agent works it`,
      );
    }
    return { questNumber: number };
  }

  /**
   * `work-feedback`: the key pinned to the item; an untrusted item no member
   * trusted never reaches an agent.
   */
  protected async prepareWorkFeedback(
    context: PromptRunContext,
  ): Promise<PromptRunPlan> {
    const number = this.numberIn(context, "feedback");
    const item = await this.feedback.findOne({
      where: {
        projectId: { eq: context.projectId },
        shortId: { eq: number },
      },
    });
    return {
      feedbackNumber: number,
      ...(item && FeedbackAgentService.awaitsTrust(item)
        ? { untrusted: true }
        : {}),
    };
  }

  /**
   * `triage`: the global triage around the prompt's text, given the pending
   * items a member trusted (its key pinned to them), with how many wait for
   * a member's trust.
   */
  protected async prepareTriage(
    context: PromptRunContext,
  ): Promise<PromptRunPlan> {
    const plan = await this.feedbackAgent.inboxPlan(
      context.projectId,
      context.startedBy,
      context.text,
    );
    if (!plan.run) {
      throw new BadRequestError(
        plan.skipped.length
          ? `Nothing to triage: ${plan.skipped.length} pending item(s) wait for a member's trust, and no error is open to an agent`
          : "Nothing to triage, or a triage is already queued or running",
      );
    }
    return {
      prompt: plan.run.prompt,
      feedbackNumbers: plan.run.feedbackNumbers,
      timeoutSeconds: plan.run.timeoutSeconds,
      workspace: "triage",
      after: plan.run.mark,
      skipped: plan.skipped,
    };
  }

  /**
   * `review-pr`: a read job at the pull request's head, or with `fix` a
   * write job on its branch; Bay checks its author can write to the
   * repository unless a member trusts them (#Q4251).
   */
  protected prepareReviewPr(context: PromptRunContext): PromptRunPlan {
    const number = this.numberIn(context, "pullRequest");
    const fix = !!context.options.fix;
    return {
      source: {
        mode: fix ? "write" : "read",
        ref: `pull/${number}/head`,
        ...(context.options.trust && context.cause.kind === "hand"
          ? {}
          : { trust: "pr-author-writes" as const }),
      },
      workspace: `pr-${number}`,
      timeoutSeconds: fix
        ? PullRequestAgentService.FIX_SECONDS
        : PullRequestAgentService.REVIEW_SECONDS,
    };
  }

  /**
   * The digits of `12`, `#12`, `#E12`.
   */
  protected numberOf(value: string): number | undefined {
    const match = /^#?[A-Za-z]?(\d{1,9})$/.exec(value.trim());
    return match ? Number(match[1]) : undefined;
  }

  protected async epicOf(context: PromptArgContext) {
    const number = this.numberOf(context.value);
    if (number === undefined) return undefined;
    const epic = await this.epics.findOne({
      where: { projectId: { eq: context.project.id }, number: { eq: number } },
    });
    if (!epic) return undefined;
    return {
      status: epic.status,
      gone: !!epic.deletedAt,
      fields: {
        reference: formatReference("epic", epic.number),
        title: epic.title,
        url: `${context.projectUrl}/epics/${epic.number}`,
        number: epic.number,
        id: epic.id,
      },
    };
  }

  protected async questOf(context: PromptArgContext) {
    const number = this.numberOf(context.value);
    if (number === undefined) return undefined;
    const quest = await this.quests.findOne({
      where: {
        projectId: { eq: context.project.id },
        shortId: { eq: number },
      },
    });
    if (!quest) return undefined;
    const status = this.mapper.questStatus(quest);
    return {
      status,
      gone: !!quest.deletedAt || status === "shelved",
      fields: {
        reference: formatReference("quest", quest.shortId),
        title: quest.title,
        url: `${context.projectUrl}/quests/${quest.shortId}`,
        number: quest.shortId,
        id: quest.id,
      },
    };
  }

  protected async feedbackOf(context: PromptArgContext) {
    const number = this.numberOf(context.value);
    if (number === undefined) return undefined;
    const item = await this.feedback.findOne({
      where: {
        projectId: { eq: context.project.id },
        shortId: { eq: number },
      },
    });
    if (!item) return undefined;
    return {
      status: item.status,
      gone: !!item.deletedAt,
      fields: {
        reference: formatReference("feedback", item.shortId),
        title: item.title,
        url: `${context.projectUrl}/feedback?feedback=${item.shortId}`,
        number: item.shortId,
        id: item.id,
      },
    };
  }
}
