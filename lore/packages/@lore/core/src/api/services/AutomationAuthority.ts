import { $inject } from "alepha";
import { ConflictError, ForbiddenError } from "alepha/server";

import type { AutomationRule } from "../schemas/automationRuleSchema.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationRunEvidence } from "./AutomationRunEvidence.ts";
import { AutomationVariables } from "./AutomationVariables.ts";

/**
 * A worker supplies only rule identity and the revision/variable versions it
 * claimed. Its own identity is never accepted as execution authority.
 */
export class AutomationAuthority {
  protected readonly evidence = $inject(AutomationRunEvidence);
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly access = $inject(AutomationAccess);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly variables = $inject(AutomationVariables);

  public async check(input: {
    automationId: string;
    revision: number;
    variables?: Array<{ key: string; version: number }>;
    effect?: { index: number; action: AutomationRule["actions"][number] };
  }) {
    const rule = await this.persistence.rules.getById(input.automationId);
    if (!rule.enabled) throw new ConflictError("Automation is disabled");
    if (rule.revision !== input.revision)
      throw new ConflictError("Automation revision changed");
    if (rule.requiresApproval || rule.health !== "active")
      throw new ConflictError(
        rule.reason ?? "Automation requires author review",
      );
    try {
      const user = await this.access.author(rule);
      await this.access.assert(rule.projectId, user, "automation:write");
      const variables = await this.variables.snapshot(rule, user);
      if (
        input.variables &&
        (variables.length !== input.variables.length ||
          variables.some(
            (value) =>
              !input.variables!.some(
                (captured) =>
                  captured.key === value.key &&
                  captured.version === value.version,
              ),
          ))
      )
        throw new ForbiddenError(
          "Shared variable versions changed; author review is required",
        );
      if (input.effect) {
        if (
          rule.rule.actions[input.effect.index]?.kind !==
          input.effect.action.kind
        )
          throw new ForbiddenError(
            "Effect does not match the claimed rule action",
          );
        await this.catalog.validateEffect(
          rule.rule,
          rule.projectId,
          user,
          input.effect.action,
        );
      }
      // Re-read after all asynchronous gates. An edit/disable during validation
      // cancels this step; a change during an already-started effect is checked
      // again before the next effect.
      const latest = await this.persistence.rules.getById(rule.id);
      if (
        !latest.enabled ||
        latest.revision !== rule.revision ||
        latest.requiresApproval ||
        latest.health !== "active"
      )
        throw new ConflictError(
          "Automation changed while validating execution",
        );
      return { rule: latest, user, variables };
    } catch (error) {
      const reason = (
        error instanceof Error
          ? error.message
          : "Automation authority is unavailable"
      ).slice(0, 1024);
      const latest = await this.persistence.rules.findById(rule.id);
      if (
        latest &&
        latest.enabled &&
        latest.revision === rule.revision &&
        !latest.requiresApproval
      )
        await this.evidence.transition(rule.id, "paused", reason, true);
      throw error;
    }
  }
}
