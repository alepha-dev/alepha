import {
  AgentAutomationKinds,
  AgentAutomationService,
  type AgentAutomationRunContext,
  type AgentAutomationRunOutcome,
  HostJobs,
} from "@lore/core/api";
import type { AgentAutomation } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { epics } from "../entities/epics.ts";
import { feedback } from "../entities/feedback.ts";
import { type Quest, quests } from "../entities/quests.ts";
import { FeedbackAgentService } from "./FeedbackAgentService.ts";
import { QuestAgentService } from "./QuestAgentService.ts";

/**
 * Plan's prompt kinds of an agent automation (#Q4226): Triage, the
 * project's `feedbackLoop` over the inbox and the open errors, the same run
 * as `lore agent run triage`; Build (#Q4229), the project's `questWork` on
 * each quest the build rule picks; and whether each has something to do
 * (#Q4228). Core runs a `text` automation itself.
 *
 * **The build rule** picks the quests that are all of: todo (not accepted,
 * completed or shelved), unassigned, not on hold, with no unfinished
 * dependency, not in a draft epic; not tagged {@link NEEDS_HUMAN}; not
 * untrusted without a member's confirmation; and never built by this
 * automation, whatever that job's outcome (a failed build is retried by
 * hand, never by the rule). Oldest first, one job per quest, as many as the
 * automation has free slots.
 */
export class PlanAutomationKinds {
  protected readonly kinds = $inject(AgentAutomationKinds);
  protected readonly automations = $inject(AgentAutomationService);
  protected readonly feedbackAgent = $inject(FeedbackAgentService);
  protected readonly feedbackRows = $repository(feedback);
  protected readonly questAgent = $inject(QuestAgentService);
  protected readonly questRows = $repository(quests);
  protected readonly epicRows = $repository(epics);
  protected readonly hostJobs = $inject(HostJobs);

  /**
   * The one tag that keeps a quest from a build automation, fixed in code
   * (decided by #E172's review): the Triage template is editable per
   * project, and a tag named per project would have to be rendered into it
   * to stay in step with the rule.
   */
  public static readonly NEEDS_HUMAN = "needs-human";

  /**
   * How many todo quests the build rule reads per run, oldest first.
   */
  public static readonly BUILD_SCAN = 200;

  constructor() {
    this.kinds.register({
      key: "triage",
      permission: "feedback:triage",
      run: (automation, context) =>
        this.triage(automation, context.startedBy, context.startedByJobId),
    });
    // A triage has something to do when a pending item an agent may read
    // waits (#Q4228): team-written, or trusted by a member (#Q4216). Ship
    // adds the trusted open errors.
    this.kinds.registerWork("triage", (automation) =>
      this.pendingFeedback(automation.projectId),
    );
    this.kinds.register({
      key: "build",
      // What building a quest by hand asks.
      permission: "quest:update",
      run: (automation, context) => this.build(automation, context),
    });
    this.kinds.registerWork(
      "build",
      async (automation) => (await this.picks(automation, 1)).length > 0,
    );
  }

  /**
   * One build job per quest the rule picks, up to the free slots.
   */
  protected async build(
    automation: AgentAutomation,
    context: AgentAutomationRunContext,
  ): Promise<AgentAutomationRunOutcome> {
    const picked = await this.picks(automation, context.slots);
    if (!picked.length) {
      return { jobIds: [], skipped: "No quest to build" };
    }
    const jobIds: string[] = [];
    for (const quest of picked) {
      const out = await this.questAgent.build(
        automation.projectId,
        quest,
        context.startedBy,
        this.automations.whereOf(automation),
        {
          automationId: automation.id,
          startedByJobId: context.startedByJobId,
          autoMerge: automation.autoMerge ?? false,
        },
      );
      jobIds.push(out.jobId);
    }
    return { jobIds };
  }

  /**
   * The quests the build rule picks now, oldest first, at most `limit`.
   */
  public async picks(
    automation: AgentAutomation,
    limit: number,
  ): Promise<Quest[]> {
    if (limit <= 0) return [];
    const candidates = await this.questRows.findMany({
      where: {
        projectId: { eq: automation.projectId },
        acceptedAt: { isNull: true },
        acceptedBy: { isNull: true },
        completedAt: { isNull: true },
        shelvedAt: { isNull: true },
        heldAt: { isNull: true },
      },
      orderBy: [{ column: "createdAt", direction: "asc" }],
      limit: PlanAutomationKinds.BUILD_SCAN,
    });
    const eligible = candidates.filter(
      (quest) =>
        !(quest.tags ?? []).includes(PlanAutomationKinds.NEEDS_HUMAN) &&
        !(quest.untrusted && !quest.untrustedConfirmedAt),
    );
    if (!eligible.length) return [];
    const built = new Set(
      await this.hostJobs.subjectsOfAutomation(automation.id, "quest"),
    );
    const dependencies = await this.questRows.findMany({
      where: {
        id: {
          inArray: [
            0,
            ...eligible
              .map((quest) => quest.dependsOn)
              .filter((id): id is number => typeof id === "number"),
          ],
        },
      },
    });
    const finished = new Set(
      dependencies
        .filter((quest) => quest.completedAt || quest.shelvedAt)
        .map((quest) => quest.id),
    );
    const drafts = new Set(
      (
        await this.epicRows.findMany({
          where: {
            projectId: { eq: automation.projectId },
            status: { eq: "draft" },
          },
        })
      ).map((epic) => epic.id),
    );
    const picked: Quest[] = [];
    for (const quest of eligible) {
      if (built.has(String(quest.shortId))) continue;
      if (quest.dependsOn && !finished.has(quest.dependsOn)) continue;
      if (quest.epicId && drafts.has(quest.epicId)) continue;
      // A job already on it, started by hand or by another automation.
      if (
        await this.hostJobs.active(
          automation.projectId,
          "quest",
          String(quest.shortId),
        )
      ) {
        continue;
      }
      picked.push(quest);
      if (picked.length >= limit) break;
    }
    return picked;
  }

  /**
   * Whether a pending feedback item an agent may read waits: two indexed
   * reads at most, no job queued.
   */
  public async pendingFeedback(projectId: number): Promise<boolean> {
    const teamWritten = await this.feedbackRows.findOne({
      where: {
        projectId: { eq: projectId },
        status: { eq: "pending" },
        untrusted: { eq: false },
      },
    });
    if (teamWritten) return true;
    const trusted = await this.feedbackRows.findOne({
      where: {
        projectId: { eq: projectId },
        status: { eq: "pending" },
        trustedAt: { isNotNull: true },
      },
    });
    return Boolean(trusted);
  }

  protected async triage(
    automation: AgentAutomation,
    startedBy: string,
    startedByJobId?: string,
  ): Promise<AgentAutomationRunOutcome> {
    const out = await this.feedbackAgent.triageInbox(
      automation.projectId,
      startedBy,
      this.automations.whereOf(automation),
      { automationId: automation.id, startedByJobId },
    );
    if (out.global) return { jobIds: [out.global] };
    return {
      jobIds: [],
      skipped: out.skipped.length
        ? `Nothing to triage: ${out.skipped.length} feedback item(s) wait for a member's trust`
        : "Nothing to triage, or a triage is already queued or running",
    };
  }
}
