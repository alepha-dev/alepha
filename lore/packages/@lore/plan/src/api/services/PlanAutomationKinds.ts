import {
  AgentAutomationKinds,
  AgentAutomationService,
  type AgentAutomationRunOutcome,
} from "@lore/core/api";
import type { AgentAutomation } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { feedback } from "../entities/feedback.ts";
import { FeedbackAgentService } from "./FeedbackAgentService.ts";

/**
 * Plan's prompt kinds of an agent automation (#Q4226): Triage, the
 * project's `feedbackLoop` over the inbox and the open errors, the same run
 * as `lore agent run triage`, and whether it has something to do (#Q4228).
 * Core runs a `text` automation itself.
 */
export class PlanAutomationKinds {
  protected readonly kinds = $inject(AgentAutomationKinds);
  protected readonly automations = $inject(AgentAutomationService);
  protected readonly feedbackAgent = $inject(FeedbackAgentService);
  protected readonly feedbackRows = $repository(feedback);

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
