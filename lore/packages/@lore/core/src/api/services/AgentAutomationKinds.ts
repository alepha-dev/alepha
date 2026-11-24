import { AlephaError } from "alepha";

import type { AgentAutomation } from "../entities/agentAutomations.ts";
import type { AutomationPromptKind } from "../schemas/agentAutomationValues.ts";

/**
 * The prompt kinds an agent automation runs (#Q4226), registered by the
 * module that renders them: Plan's Triage (`feedbackLoop`) and Build
 * (`questWork`). Core runs a `text` automation itself, so it needs no
 * registration. Core reads no Plan table: what a triage or a build is about
 * is the kind's.
 */
export class AgentAutomationKinds {
  protected readonly kinds = new Map<string, AgentAutomationKind>();

  public register(kind: AgentAutomationKind): void {
    if (this.kinds.has(kind.key)) {
      throw new AlephaError(
        `Agent automation kind '${kind.key}' is registered twice`,
      );
    }
    this.kinds.set(kind.key, kind);
  }

  public find(key: string): AgentAutomationKind | undefined {
    return this.kinds.get(key);
  }
}

/**
 * What a run of an automation is given: who starts it (the member whose
 * rank bounds its keys), and the job whose output caused it, when an event
 * raised by a job did (#Q4227).
 */
export interface AgentAutomationRunContext {
  startedBy: string;
  startedByJobId?: string;
  /**
   * How many jobs this run may start: the automation's free slots. A build
   * starts one per quest; every other kind starts one.
   */
  slots: number;
}

/**
 * What a run started: its jobs, or why it started none.
 */
export interface AgentAutomationRunOutcome {
  jobIds: string[];
  skipped?: string;
}

export interface AgentAutomationKind {
  key: Exclude<AutomationPromptKind, "text">;
  /**
   * The permission the run's starter must hold, as a run by hand of the
   * same prompt asks (`feedback:triage` for a triage).
   */
  permission: string;
  run(
    automation: AgentAutomation,
    context: AgentAutomationRunContext,
  ): Promise<AgentAutomationRunOutcome>;
}
