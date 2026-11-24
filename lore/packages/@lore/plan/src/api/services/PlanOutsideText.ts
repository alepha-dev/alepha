import { JobKeyService, type OutsideText } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { formatReference } from "@lore/core/web";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { feedback } from "../entities/feedback.ts";
import { quests } from "../entities/quests.ts";

/**
 * What a job key may not read (#Q4287): a feedback item written outside the
 * team that no member trusted (`untrusted` without `trustedAt`), and a quest
 * born of one that nobody confirmed (`untrusted` without
 * `untrustedConfirmedAt`). One rule in the job key, whatever the prompt
 * asked, registered on core's `JobKeyService`: a tool naming one is refused,
 * and every read that carries their text leaves them out (`hiddenFor`).
 *
 * A member's own session or API key is untouched.
 */
export class PlanOutsideText {
  /**
   * The feedback tools that name no one item.
   */
  public static readonly UNNAMED_FEEDBACK_TOOLS = new Set([
    "feedback_list",
    "feedback_submit",
    "feedback_targets",
  ]);

  /**
   * The quest tools that name no one quest.
   */
  public static readonly UNNAMED_QUEST_TOOLS = new Set([
    "quest_list",
    "quest_create",
    "quest_tags",
  ]);

  protected readonly keys = $inject(JobKeyService);
  protected readonly feedback = $repository(feedback);
  protected readonly quests = $repository(quests);
  protected readonly projects = $repository(projects);

  constructor() {
    this.keys.registerOutsideText({
      hidden: (projectId) => this.hidden(projectId),
      refuse: (projectId, name, args) => this.refuse(projectId, name, args),
    });
  }

  public async hidden(projectId: number): Promise<OutsideText> {
    const [project, items, born] = await Promise.all([
      this.projects.findOne({ where: { id: { eq: projectId } } }),
      this.feedback.findMany({
        where: {
          projectId: { eq: projectId },
          untrusted: { eq: true },
          trustedAt: { isNull: true },
        },
        columns: ["shortId"],
      }),
      this.quests.findMany({
        where: {
          projectId: { eq: projectId },
          untrusted: { eq: true },
          untrustedConfirmedAt: { isNull: true },
        },
        columns: ["shortId"],
      }),
    ]);
    return {
      feedback: new Set(items.map((it) => it.shortId)),
      quests: new Set(born.map((it) => it.shortId)),
      slug: project?.slug ?? String(projectId),
    };
  }

  protected async refuse(
    projectId: number,
    name: string,
    args: Record<string, unknown>,
  ): Promise<string | undefined> {
    const number = (value: unknown) =>
      typeof value === "number" ? value : undefined;
    const hidden = await this.hidden(projectId);
    const refuseFeedback = (shortId: number) =>
      `Feedback ${formatReference("feedback", shortId)} was written outside the team and no member has trusted it: a member trusts it on its page before an agent job reads it`;

    if (
      name.startsWith("feedback_") &&
      !PlanOutsideText.UNNAMED_FEEDBACK_TOOLS.has(name)
    ) {
      const shortId = await this.feedbackNumberOf(projectId, args);
      if (shortId !== undefined && hidden.feedback.has(shortId)) {
        return refuseFeedback(shortId);
      }
    }
    if (
      name.startsWith("quest_") &&
      !PlanOutsideText.UNNAMED_QUEST_TOOLS.has(name)
    ) {
      const shortId = await this.questNumberOf(projectId, args);
      if (shortId !== undefined && hidden.quests.has(shortId)) {
        return `Quest ${formatReference("quest", shortId)} was born of feedback written outside the team: a member confirms its text on the quest before an agent job reads it`;
      }
    }
    // A quest linked to an item takes its text: no link to one nobody trusted.
    const linked = number(args.feedback_shortId);
    if (linked !== undefined && hidden.feedback.has(linked)) {
      return refuseFeedback(linked);
    }
    return undefined;
  }

  protected async feedbackNumberOf(
    projectId: number,
    args: Record<string, unknown>,
  ): Promise<number | undefined> {
    if (typeof args.shortId === "number") return args.shortId;
    if (typeof args.id !== "number") return undefined;
    const row = await this.feedback.findOne({
      where: { projectId: { eq: projectId }, id: { eq: args.id } },
    });
    return row?.shortId;
  }

  protected async questNumberOf(
    projectId: number,
    args: Record<string, unknown>,
  ): Promise<number | undefined> {
    if (typeof args.shortId === "number") return args.shortId;
    if (typeof args.id !== "number") return undefined;
    const row = await this.quests.findOne({
      where: { projectId: { eq: projectId }, id: { eq: args.id } },
    });
    return row?.shortId;
  }
}
