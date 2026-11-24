import { type PromptArgContext, PromptRegistry } from "@lore/core/api";
import { formatReference } from "@lore/core/web";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

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
      needs: epicsOption,
      text: reviewEpicPromptText,
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
      timeoutSeconds: 2 * 60 * 60,
      needs: epicsOption,
      text: workEpicPromptText,
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
      text: workQuestPromptText,
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
      needs: feedbackOption,
      text: workFeedbackPromptText,
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
      needs: feedbackOption,
      text: triagePromptText,
      oneShot: true,
    });
    this.registry.register({
      name: "work-loose-quests",
      title: "Work the loose quests",
      description:
        "Work every quest under no epic, one pull request for the run.",
      args: [],
      source: "write",
      permission: "quest:update",
      timeoutSeconds: 2 * 60 * 60,
      text: workLooseQuestsPromptText,
      oneShot: true,
    });
    this.registry.register({
      name: "weekly-status",
      title: "Weekly status",
      description:
        "Write the week's status from the project's reports, changing nothing.",
      args: [],
      source: "none",
      permission: "host:read",
      timeoutSeconds: 30 * 60,
      text: weeklyStatusPromptText,
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
    });
    this.registry.registerArg({
      type: "feedback",
      permission: "feedback:read",
      resolve: (context) => this.feedbackOf(context),
    });
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
