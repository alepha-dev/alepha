import { $inject } from "alepha";
import { DbEntityNotFoundError, DbError } from "alepha/orm";
import { ConflictError, ForbiddenError, isHttpError } from "alepha/server";

import type { AutomationRule } from "../schemas/automationRuleSchema.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import {
  AutomationDependencies,
  AutomationDependencyError,
} from "./AutomationDependencies.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationRunEvidence } from "./AutomationRunEvidence.ts";
import { AutomationVariables } from "./AutomationVariables.ts";

/**
 * A worker supplies only rule identity and the revision/variable versions it
 * claimed. Its own identity is never accepted as execution authority.
 */
export class AutomationAuthority {
  protected readonly dependencies = $inject(AutomationDependencies);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly evidence = $inject(AutomationRunEvidence);
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly access = $inject(AutomationAccess);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly variables = $inject(AutomationVariables);

  public async check(input: {
    automationId: string;
    revision: number;
    variables?: Array<{ id?: string; key: string; version: number }>;
    readOnly?: boolean;
    effect?: { index: number; action: AutomationRule["actions"][number] };
  }) {
    return this.database.primary(() => this.checkPrimary(input));
  }

  protected async checkPrimary(
    input: Parameters<AutomationAuthority["check"]>[0],
  ) {
    const rule = await this.persistence.rules.getById(input.automationId);
    if (!rule.enabled) throw new ConflictError("Automation is disabled");
    if (rule.revision !== input.revision)
      throw new ConflictError("Automation revision changed");
    if (rule.requiresApproval || rule.health !== "active")
      throw new ConflictError(
        rule.reason ?? "Automation requires author review",
      );
    try {
      await this.dependencies.assert(rule);
      const user = await this.access.author(rule);
      await this.access.assert(rule.projectId, user, "automation:write");
      const variables = await this.variables.snapshot(rule, user, {
        transition: false,
      });
      if (
        input.variables &&
        (variables.length !== input.variables.length ||
          variables.some(
            (value) =>
              !input.variables!.some(
                (captured) =>
                  captured.id === value.id &&
                  captured.key === value.key &&
                  captured.version === value.version,
              ),
          ))
      )
        throw new ForbiddenError(
          "Shared variable versions changed; author review is required",
        );
      this.variables.assertApproved(rule, variables);
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
      // A transient failure (a driver error, a timeout) says nothing about
      // the author's authority: it propagates without pausing the rule, so
      // the next attempt can succeed without anyone re-approving it.
      if (!this.refusal(error)) throw error;
      const reason = (
        error instanceof Error
          ? error.message
          : "Automation authority is unavailable"
      ).slice(0, 1024);
      const latest = await this.persistence.rules.findById(rule.id);
      if (
        !input.readOnly &&
        latest &&
        latest.enabled &&
        latest.revision === rule.revision &&
        !latest.requiresApproval
      )
        await this.evidence.transition(
          rule.id,
          error instanceof AutomationDependencyError ? "broken" : "paused",
          reason,
          !(error instanceof AutomationDependencyError),
          { expectedVersion: latest.version },
        );
      throw error;
    }
  }

  /**
   * Whether an error is a refusal of the author's authority: a dependency
   * the rule lost, or a 4xx the access, variable and catalogue checks throw
   * (missing grant or credential, a changed or vanished variable, an invalid
   * effect). Database errors are HTTP errors too; only a missing row among
   * them is a refusal, the rest (500, 503, a deadlock's 409) are transient.
   */
  protected refusal(error: unknown): boolean {
    if (error instanceof AutomationDependencyError) return true;
    if (error instanceof DbError) return error instanceof DbEntityNotFoundError;
    return (
      isHttpError(error) &&
      [400, 401, 403, 404, 409, 410, 422].includes(error.status)
    );
  }
}
