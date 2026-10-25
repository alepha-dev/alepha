import { $inject, AlephaError } from "alepha";
import { BadRequestError } from "alepha/server";

import type { AutomationReceipt } from "../entities/automationReceipts.ts";
import type { AutomationRule } from "../schemas/automationRuleSchema.ts";
import { AutomationAuthority } from "./AutomationAuthority.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationClaims } from "./AutomationClaims.ts";
import type { AutomationRenderContext } from "./AutomationContextBuilder.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import {
  AutomationMutationContext,
  type AutomationMutationState,
} from "./AutomationMutationContext.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationTemplateRenderer } from "./AutomationTemplateRenderer.ts";

/**
 * Four feature-owned handlers, executing normal server actions as the current
 * immutable author. A receipt is checked before any controller is invoked.
 */
export class AutomationDomainActions {
  protected readonly handlers = new Map<
    AutomationDomainAction["kind"],
    AutomationDomainHandler
  >();
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly authority = $inject(AutomationAuthority);
  protected readonly claims = $inject(AutomationClaims);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly renderer = $inject(AutomationTemplateRenderer);
  protected readonly mutations = $inject(AutomationMutationContext);
  protected readonly database = $inject(AutomationDatabase);

  public register(
    kind: AutomationDomainAction["kind"],
    handler: AutomationDomainHandler,
  ): void {
    if (this.handlers.has(kind))
      throw new AlephaError(
        `Automation domain adapter '${kind}' already exists`,
      );
    this.handlers.set(kind, handler);
  }
  /**
   * Read-only target preflight shared with execution. It never invokes the
   * controller closure, reserves a counter or creates execution evidence.
   */
  public async preview(
    input: Pick<AutomationMutationState, "rule" | "user" | "action">,
  ) {
    return this.database.primary(async () => {
      await this.catalog.validateEffect(
        input.rule.rule,
        input.rule.projectId,
        input.user,
        input.action,
      );
      const handler = this.handlers.get(input.action.kind);
      if (!handler) throw new BadRequestError("Domain adapter is unavailable");
      const plan = await handler.prepare(input);
      return {
        changed: !plan.unchanged,
        ...(plan.unchanged ? { result: plan.unchanged } : {}),
      };
    });
  }
  public async execute(input: {
    occurrenceId: string;
    token: string;
    index: number;
    row?: number;
    context: AutomationRenderContext;
  }): Promise<AutomationReceipt> {
    return this.database.primary(async () => {
      const occurrence = await this.claims.lease(
        input.occurrenceId,
        input.token,
      );
      const rule = await this.persistence.rules.getById(
        occurrence.automationId!,
      );
      const ast = occurrence.snapshot?.rule?.actions[input.index];
      if (!ast)
        throw new BadRequestError("Action was not frozen in the occurrence");
      const rendered = this.renderer.render(
        ast,
        input.context,
        occurrence.snapshot!.variables,
      );
      const action = rendered.raw;
      if (action.kind === "notify")
        throw new BadRequestError("NOTIFY has its own outbox adapter");
      const current = await this.authority.check({
        automationId: rule.id,
        revision: occurrence.ruleRevision,
        variables: occurrence.snapshot!.variables,
        effect: { index: input.index, action },
      });
      const operation = await this.claims.beginAction(
        occurrence.id,
        input.token,
        { index: input.index, row: input.row, action, mode: "atomic" },
      );
      if (operation.status !== "claimed") return operation;
      if (rendered.suppressed)
        return this.claims.atomicEffect(occurrence.id, input.token, {
          index: input.index,
          row: input.row,
          action,
          statements: [],
          result: { changed: false, skipped: true },
        });
      const handler = this.handlers.get(action.kind);
      if (!handler) throw new BadRequestError("Domain adapter is unavailable");
      const plan = await handler.prepare({ rule, user: current.user, action });
      if (plan.unchanged)
        return this.claims.atomicEffect(occurrence.id, input.token, {
          index: input.index,
          row: input.row,
          action,
          statements: [],
          result: { changed: false, ...plan.unchanged },
        });
      const state: AutomationMutationState = {
        rule,
        user: current.user,
        occurrence,
        operation,
        token: input.token,
        index: input.index,
        row: input.row,
        action,
        target: plan.target,
        condition: plan.condition,
        result: plan.result,
      };
      await this.mutations.run(state, plan.invoke);
      if (!state.committed)
        throw new AlephaError(
          "Domain adapter returned without its atomic root commit",
        );
      return state.committed;
    });
  }
}
export type AutomationDomainAction = Exclude<
  AutomationRule["actions"][number],
  { kind: "notify" }
>;
export interface AutomationDomainHandler {
  prepare(
    input: Pick<AutomationMutationState, "rule" | "user" | "action">,
  ): Promise<{
    target: AutomationMutationState["target"];
    condition?: AutomationMutationState["condition"];
    result: AutomationMutationState["result"];
    unchanged?: NonNullable<AutomationReceipt["result"]>;
    invoke: () => Promise<unknown>;
  }>;
}
