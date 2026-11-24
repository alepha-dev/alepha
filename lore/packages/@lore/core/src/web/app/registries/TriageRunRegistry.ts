import { AlephaError } from "alepha";

import type { AgentPromptsMenuAction } from "../components/project/prompts/AgentPromptsMenu.tsx";

/**
 * The robot menu's "Triage feedback and errors" run (#Q4240), offered from
 * the Feedback page and from the Errors page alike.
 *
 * Plan owns the run (one agent job over the pending feedback and the trusted
 * error groups, #Q4224) and registers the hook that builds its entries; Ship,
 * which may not import Plan, reads them here for its Errors page.
 *
 * ⚠️ A hook, called during render: registered once at boot, so every render
 * calls the same one and the rules of hooks hold.
 */
export class TriageRunRegistry {
  protected hook?: (onStarted?: () => void) => AgentPromptsMenuAction[];

  public register(
    hook: (onStarted?: () => void) => AgentPromptsMenuAction[],
  ): void {
    if (this.hook) {
      throw new AlephaError("The triage run is registered twice");
    }
    this.hook = hook;
  }

  /**
   * The registered hook, or one that offers nothing when Plan is not booted.
   */
  public get use(): (onStarted?: () => void) => AgentPromptsMenuAction[] {
    return this.hook ?? this.none;
  }

  protected none = (): AgentPromptsMenuAction[] => [];
}
