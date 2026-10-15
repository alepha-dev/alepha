import { $inject, Alepha, AlephaError, type Infer, type ZObject } from "alepha";
import { audits, type CreateAudit } from "alepha/api/audits";
import type { SQLLike } from "alepha/orm";
import { currentUserAtom, type UserAccountToken } from "alepha/security";
import { ConflictError, ForbiddenError } from "alepha/server";

import type { AutomationReceipt } from "../entities/automationReceipts.ts";
import type { Automation } from "../entities/automations.ts";
import type { AutomationRule } from "../schemas/automationRuleSchema.ts";
import { AutomationBatchRepository } from "./AutomationBatchRepository.ts";
import { AutomationClaims } from "./AutomationClaims.ts";
import { AutomationOrigin } from "./AutomationOrigin.ts";

/**
 * A normal controller owns validation and its lifecycle. This scoped seam
 * changes only its one root commit, joining the validated row, native audit,
 * revision sidecars and effect receipt. Ordinary requests use their fallback.
 */
export class AutomationMutationContext {
  protected readonly alepha = $inject(Alepha);
  protected readonly origin = $inject(AutomationOrigin);
  protected readonly auditRows = $inject(AutomationBatchRepository.of(audits));

  public get current(): AutomationMutationState | undefined {
    const state = this.alepha.context.get("lore.automations.mutation") as
      | AutomationMutationState
      | undefined;
    return state && this.origin.current?.operationId === state.operation.id
      ? state
      : undefined;
  }
  public async run<T>(
    state: AutomationMutationState,
    handler: () => Promise<T>,
  ): Promise<T> {
    return this.alepha.context.nest(() => {
      this.alepha.context.set("lore.automations.mutation", state);
      this.alepha.store.set(currentUserAtom, state.user);
      return this.origin.run(
        {
          projectId: state.rule.projectId,
          automationId: state.rule.id,
          runId: state.occurrence.runId,
          operationId: state.operation.id,
        },
        handler,
      );
    });
  }
  public async save<T extends ZObject>(
    input: {
      repository: AutomationBatchRepository<T>;
      entity: Infer<T>;
      audit: CreateAudit;
      before?: SQLLike[];
      after?: SQLLike[];
      condition?: SQLLike;
      changedTables?: string[];
    },
    fallback: () => Promise<void>,
  ): Promise<void> {
    const state = this.current;
    if (!state) return fallback();
    const mutation = await input.repository.prepareEffectSave(input.entity);
    this.assertTarget(
      state,
      input.repository.tableName,
      mutation.data,
      "update",
    );
    const result = state.result(input.repository, mutation.data);
    const committed = await this.commit({
      ...input,
      state,
      statement: mutation.statement,
      rootCondition: mutation.condition,
      ...result,
    });
    const raw = committed.rows?.[input.before?.length ?? 0]?.[0];
    if (!raw)
      throw new ConflictError("Another worker committed this domain effect");
    const updated = await input.repository.finishEffect(
      "update",
      raw,
      mutation.data,
      mutation.where,
    );
    for (const key of Object.keys(input.entity as object))
      delete (input.entity as Record<string, unknown>)[key];
    Object.assign(input.entity as object, updated);
  }
  public async create<T extends ZObject>(
    input: {
      repository: AutomationBatchRepository<T>;
      data: Parameters<AutomationBatchRepository<T>["create"]>[0];
      audit: CreateAudit;
      identity: (
        data: Record<string, unknown>,
      ) => Parameters<AutomationBatchRepository<T>["updateOne"]>[0];
    },
    fallback: () => Promise<Infer<T>>,
  ): Promise<Infer<T>> {
    const state = this.current;
    if (!state) return fallback();
    const mutation = await input.repository.prepareEffectCreate(input.data);
    const data = mutation.data as Record<string, unknown>;
    this.assertTarget(state, input.repository.tableName, data, "create");
    const identity = input.identity(data);
    const result = state.result(input.repository, data);
    const committed = await this.commit({
      ...input,
      state,
      statement: mutation.statement,
      rootCondition: input.repository.notExists(identity),
      ...result,
    });
    const raw = committed.rows?.[0]?.[0];
    if (!raw)
      throw new ConflictError("Another worker committed this domain effect");
    return input.repository.finishEffect("create", raw, data);
  }
  public consumeAudit(
    type: string,
    action: string,
    options: Omit<CreateAudit, "type" | "action">,
  ) {
    const state = this.current;
    const audit = state?.nativeAudit;
    if (
      !audit ||
      audit.type !== type ||
      audit.action !== action ||
      audit.resourceId !== options.resourceId ||
      audit.scopeId !== options.scopeId
    )
      return undefined;
    const activity = state.telemetryRecorded ? undefined : audit;
    state.telemetryRecorded = true;
    return { activity };
  }
  protected assertTarget(
    state: AutomationMutationState,
    table: string,
    data: Record<string, unknown>,
    mode: "create" | "update",
  ): void {
    if (state.committed)
      throw new ConflictError("The domain root was already committed");
    if (
      state.target.table !== table ||
      state.target.mode !== mode ||
      data.projectId !== state.rule.projectId ||
      (state.target.id !== undefined && data.id !== state.target.id)
    )
      throw new ForbiddenError(
        "Domain mutation differs from its authorized target",
      );
  }
  protected async commit(input: {
    state: AutomationMutationState;
    repository: AutomationBatchRepository<any>;
    audit: CreateAudit;
    statement: SQLLike;
    rootCondition: SQLLike;
    condition?: SQLLike;
    before?: SQLLike[];
    after?: SQLLike[];
    changedTables?: string[];
    result: NonNullable<AutomationReceipt["result"]>;
    expressions?: Record<string, SQLLike>;
  }) {
    const state = input.state;
    const audit: CreateAudit = {
      ...input.audit,
      description: input.audit.description?.slice(0, 255),
      metadata: {
        ...(input.audit.metadata as Record<string, unknown> | undefined),
        automationId: state.rule.id,
        runId: state.occurrence.runId,
        operationId: state.operation.id,
      },
      success: true,
      severity: "info",
    };
    if (
      audit.userId !== state.rule.authorUserId ||
      audit.scopeType !== "project" ||
      audit.scopeId !== String(state.rule.projectId)
    )
      throw new AlephaError(
        "Automation audit must name its author and project",
      );
    const claims = this.alepha.inject(AutomationClaims);
    const committed = await claims.atomicMutation(
      state.occurrence.id,
      state.token,
      {
        index: state.index,
        row: state.row,
        action: state.action,
        statements: [
          ...(input.before ?? []),
          input.statement,
          ...(input.after ?? []),
          this.auditRows.insertStatement(audit),
        ],
        condition: input.repository.andConditions([
          input.rootCondition,
          ...(input.condition ? [input.condition] : []),
          ...(state.condition ? [state.condition] : []),
        ]),
        result: { ...input.result, audit_recorded: true },
        resultExpressions: input.expressions,
        changedTables: [
          input.repository.tableName,
          "audits",
          ...(input.changedTables ?? []),
        ],
      },
    );
    if (committed.receipt.status !== "committed")
      throw new ConflictError("Domain effect did not commit");
    state.committed = committed.receipt;
    state.nativeAudit = audit;
    return committed;
  }
}

export interface AutomationMutationState {
  rule: Automation;
  user: UserAccountToken;
  occurrence: AutomationReceipt;
  operation: AutomationReceipt;
  token: string;
  index: number;
  row?: number;
  action: Exclude<AutomationRule["actions"][number], { kind: "notify" }>;
  target: { table: string; mode: "create" | "update"; id?: string | number };
  condition?: SQLLike;
  result: (
    repository: AutomationBatchRepository<any>,
    data: Record<string, unknown>,
  ) => {
    result: NonNullable<AutomationReceipt["result"]>;
    expressions?: Record<string, SQLLike>;
  };
  committed?: AutomationReceipt;
  nativeAudit?: CreateAudit;
  telemetryRecorded?: boolean;
}

declare module "alepha" {
  interface State {
    "lore.automations.mutation"?: AutomationMutationState;
  }
}
