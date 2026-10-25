import { AlephaError } from "alepha";
import type { LucideIcon } from "lucide-react";

import type { AgentPromptKind } from "../../../api/schemas/agentPromptKindSchema.ts";

/**
 * The agent prompt kinds and their built-in defaults, as each module
 * registers them (#E75, #Q2624): Work's epic, quest and feedback prompts,
 * Deploy's blight triage.
 *
 * The default is what a project gets before anyone edits it in Settings >
 * Quests > Agent prompts, and what Reset restores. `project_prompts` holds
 * one row per CUSTOMISED kind, so absence there means the registered
 * default. A project with the switch on and no rows pays no request and
 * gets these.
 *
 * The menu row keeps the icon and the label of the kind it is, so a caller
 * cannot give one kind another's.
 */
export class AgentPromptRegistry {
  protected readonly entries = new Map<AgentPromptKind, AgentPromptKindEntry>();

  public register(entry: AgentPromptKindEntry): void {
    if (this.entries.has(entry.kind)) {
      throw new AlephaError(
        `Agent prompt kind '${entry.kind}' is registered twice`,
      );
    }
    this.entries.set(entry.kind, entry);
  }

  /**
   * The kind, or a refusal: a menu offering a kind no module registered
   * would put `undefined` on somebody's clipboard.
   */
  public get(kind: AgentPromptKind): AgentPromptKindEntry {
    const entry = this.entries.get(kind);
    if (!entry) {
      throw new AlephaError(`Agent prompt kind '${kind}' is not registered`);
    }
    return entry;
  }

  public all(): AgentPromptKindEntry[] {
    return [...this.entries.values()];
  }
}

export interface AgentPromptKindEntry {
  /**
   * Persisted in `project_prompts.kind`: a rename orphans every stored
   * template, so a kind keeps its name when its label moves.
   */
  kind: AgentPromptKind;
  template: string;
  icon: LucideIcon;
  labelKey: string;
}
