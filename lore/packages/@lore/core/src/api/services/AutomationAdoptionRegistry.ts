import { AlephaError } from "alepha";

import type { AutomationAdoptionPolicy } from "../schemas/automationAdoptionPolicySchema.ts";
import type { AutomationRule } from "../schemas/automationRuleSchema.ts";

/**
 * Features own compatibility programs and parity previews; core owns their atomic choice.
 */
export class AutomationAdoptionRegistry {
  protected readonly policies = new Map<
    AutomationAdoptionPolicy,
    AutomationAdoptionDefinition
  >();
  public register(
    policy: AutomationAdoptionPolicy,
    definition: AutomationAdoptionDefinition,
  ): void {
    if (this.policies.has(policy))
      throw new AlephaError(`Duplicate automation adoption policy '${policy}'`);
    this.policies.set(policy, definition);
  }
  public get(policy: AutomationAdoptionPolicy): AutomationAdoptionDefinition {
    const definition = this.policies.get(policy);
    if (!definition)
      throw new AlephaError(
        `Automation adoption policy '${policy}' is unavailable`,
      );
    return definition;
  }
}
export interface AutomationAdoptionDefinition {
  title: string;
  description: string;
  permissions: string[];
  channels: string[];
  build: () => AutomationRule;
  matches: (rule: AutomationRule) => boolean;
  preview: (
    projectId: number,
    authorUserId: string,
  ) => Promise<{
    recipients: Array<{ value: string; label: string }>;
    recipientsHasMore: boolean;
    reminderCount?: number;
    reminders?: Array<{
      id: number;
      shortId: number;
      assigneeId: string;
      interval: string;
      nextAt: string;
    }>;
  }>;
}
