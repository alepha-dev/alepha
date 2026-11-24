import {
  AgentAutomationKinds,
  AgentAutomationService,
  type AgentAutomationRunOutcome,
} from "@lore/core/api";
import type { AgentAutomation } from "@lore/core/schemas";
import { $inject } from "alepha";

import { FeedbackAgentService } from "./FeedbackAgentService.ts";

/**
 * Plan's prompt kinds of an agent automation (#Q4226): Triage, the
 * project's `feedbackLoop` over the inbox and the open errors, the same run
 * as `lore agent run triage`. Core runs a `text` automation itself.
 */
export class PlanAutomationKinds {
  protected readonly kinds = $inject(AgentAutomationKinds);
  protected readonly automations = $inject(AgentAutomationService);
  protected readonly feedbackAgent = $inject(FeedbackAgentService);

  constructor() {
    this.kinds.register({
      key: "triage",
      permission: "feedback:triage",
      run: (automation, context) =>
        this.triage(automation, context.startedBy, context.startedByJobId),
    });
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
