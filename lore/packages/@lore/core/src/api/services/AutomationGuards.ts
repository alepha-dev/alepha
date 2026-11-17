import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { DbCacheProvider, sql } from "alepha/orm";
import { BadRequestError, ConflictError } from "alepha/server";

import type { Automation } from "../entities/automations.ts";
import { AutomationGraph } from "../schemas/AutomationGraph.ts";
import type { AutomationGraphNode } from "../schemas/automationGraphNodeSchema.ts";
import type { AutomationGraphValue } from "../schemas/automationGraphSchema.ts";
import type { AutomationGuard } from "../schemas/automationGuardSchema.ts";
import type { AutomationRunSnapshot } from "../schemas/automationRunSnapshotSchema.ts";
import { AutomationTemplateBindings } from "../schemas/AutomationTemplateBindings.ts";
import { AutomationVocabulary } from "../schemas/AutomationVocabulary.ts";
import { AutomationAtomic } from "./AutomationAtomic.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationClaims } from "./AutomationClaims.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationIdentity } from "./AutomationIdentity.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";

/**
 * Pure comparisons plus an explicitly separate durable observation. Dry runs
 * call evaluate only. A crossing decision and its next baseline commit in one
 * native batch under a live occurrence lease, before any action can execute.
 */
export class AutomationGuards {
  protected readonly bindings = $inject(AutomationTemplateBindings);
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly identity = $inject(AutomationIdentity);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly claims = $inject(AutomationClaims);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly atomic = $inject(AutomationAtomic);
  protected readonly cache = $inject(DbCacheProvider);
  protected readonly time = $inject(DateTimeProvider);
  protected readonly graphs = $inject(AutomationGraph);

  /**
   * Whether what a crossing compares changed: the graph's reads and
   * conditions. A change resets the baseline.
   */
  public configurationChanged(
    before: AutomationGraphValue,
    after: AutomationGraphValue,
  ): Promise<boolean> {
    const predicate = (rule: AutomationGraphValue) =>
      rule.nodes
        .filter((node) => node.kind === "read" || node.kind === "condition")
        .map(({ id, type, config }) => ({ id, type, config }));
    return Promise.all([
      this.identity.hash(predicate(before)),
      this.identity.hash(predicate(after)),
    ]).then(([left, right]) => left !== right);
  }

  public async evaluate(
    input: AutomationGuardInput,
  ): Promise<AutomationGuardResult> {
    const graph = input.graph ?? input.rule.rule;
    // Absent, the graph's one condition, as the v1 guard was.
    const node = input.node ?? this.graphs.conditions(graph)[0];
    if (!node) return { matched: true, noData: false };
    const guard = node.config as AutomationGuard;
    const sourceKey = this.graphs.sourceKey(graph);
    const schedule =
      this.graphs.source(graph).type === AutomationVocabulary.SCHEDULE;
    const read = this.graphs.read(graph);
    const descriptor = this.catalog
      .entries()
      .find((entry) => entry.key === sourceKey);
    if (!descriptor || !Object.hasOwn(descriptor.fields, guard.field))
      throw new BadRequestError("Guard field is unavailable");
    const kind = descriptor.fields[guard.field];
    const numeric = !["eq", "ne"].includes(guard.operator);
    if (numeric && kind !== "number")
      throw new BadRequestError("Guard requires a numeric field");
    if (
      ["delta", "crossesAbove"].includes(guard.operator) &&
      (descriptor.result !== "scalar" ||
        !schedule ||
        !descriptor.operators.includes(guard.operator))
    )
      throw new BadRequestError(
        "Guard operator is unavailable for this source",
      );
    const variables = new Map(
      input.variables.map((variable) => [
        variable.key,
        { kind: variable.value.kind, available: true, value: variable.value },
      ]),
    );
    const current = input.context[guard.field];
    if (current === null || current === undefined)
      return { matched: false, noData: true };
    this.bindings.assert({ kind, required: true }, current, "guard.field");
    const threshold = this.bindings.resolve({
      slot: { kind, required: true },
      value: guard.value,
      fields: descriptor.fields,
      variables,
      context: input.context,
      path: "guard.value",
    }).value;
    if (guard.operator === "eq")
      return { matched: current === threshold, noData: false };
    if (guard.operator === "ne")
      return { matched: current !== threshold, noData: false };
    if (typeof current !== "number" || typeof threshold !== "number")
      throw new BadRequestError("Guard comparison requires finite numbers");
    if (guard.operator === "delta") {
      if (guard.field !== "value")
        throw new BadRequestError("Delta requires the scalar value");
      if (threshold < 0)
        throw new BadRequestError(
          "Coverage drop threshold must be nonnegative",
        );
      const previous = input.context.previous;
      if (typeof previous !== "number" || !Number.isFinite(previous))
        return { matched: false, noData: true };
      // A drop in percentage points, strict: equal to N does not fire.
      return { matched: previous - current > threshold, noData: false };
    }
    if (guard.operator !== "crossesAbove") {
      const matched =
        guard.operator === "lt"
          ? current < threshold
          : guard.operator === "lte"
            ? current <= threshold
            : guard.operator === "gt"
              ? current > threshold
              : current >= threshold;
      return { matched, noData: false };
    }
    const filters: Record<string, unknown> = {};
    for (const [key, slot] of Object.entries(descriptor.slots)) {
      const value =
        (read?.config.filters as Record<string, unknown> | undefined)?.[key] ??
        slot.default;
      if (value === undefined && !slot.required) continue;
      filters[key] = this.bindings.resolve({
        slot,
        value,
        fields: {},
        variables,
        path: `select.filters.${key}`,
      }).value;
    }
    const signature = await this.identity.hash({
      metric: descriptor.key,
      filters,
      field: guard.field,
      operator: guard.operator,
      threshold,
    });
    const baseline = input.rule.baseline;
    const previous =
      baseline?.signature === signature && typeof baseline.value === "number"
        ? baseline.value
        : undefined;
    return {
      matched:
        previous !== undefined && previous <= threshold && current > threshold,
      noData: false,
      signature,
      value: current,
      ...(previous !== undefined ? { previous } : {}),
    };
  }

  /**
   * Idempotent per occurrence. Recovery reads the original decision, even when
   * the baseline already moved. Missing observations leave the baseline alone.
   */
  public async observe(input: {
    occurrenceId: string;
    token: string;
  }): Promise<AutomationGuardResult> {
    return this.database.primary(async () => {
      const occurrence = await this.claims.lease(
        input.occurrenceId,
        input.token,
      );
      const id = `observation:${occurrence.id}`;
      const existing = await this.persistence.receipts.findById(id);
      if (existing?.result)
        return existing.result as unknown as AutomationGuardResult;
      const rule = await this.persistence.rules.getById(
        occurrence.automationId!,
      );
      const graph = occurrence.snapshot!.rule!;
      const node = this.graphs
        .conditions(graph)
        .find((item) => item.config.operator === "crossesAbove");
      if (!node) return { matched: true, noData: false };
      const decision = await this.evaluate({
        rule,
        graph,
        node,
        context: occurrence.snapshot!.inputs,
        variables: occurrence.snapshot?.variables ?? [],
      });
      if (
        !occurrence.runId ||
        !(await this.persistence.runs.findById(occurrence.runId))
      )
        throw new ConflictError(
          "Persist run evidence before observing a crossing",
        );
      const recorded = { matched: decision.matched, noData: decision.noData };
      const now = this.time.nowISOString();
      const baseline = decision.noData
        ? rule.baseline
        : {
            signature: decision.signature!,
            value: decision.value!,
            observedAt: now,
          };
      await this.atomic.guarded(
        rule.projectId,
        sql`EXISTS ${this.persistence.rules.subquery({
          id: rule.id,
          version: rule.version,
          revision: occurrence.ruleRevision,
          enabled: true,
          health: "active",
          requiresApproval: false,
        })} AND EXISTS ${this.persistence.receipts.subquery({
          id: occurrence.id,
          status: "claimed",
          leaseToken: input.token,
          leaseUntil: { gt: now },
        })}`,
        [
          // Bookkeeping: no `updated_at`, and by id alone, as the raw
          // statement was (the guard above already checked the row).
          this.persistence.rules.updateStatement(
            { id: rule.id },
            { baseline: baseline ?? null },
            { touch: false, force: true, returning: false },
          ),
          this.persistence.receipts.insertStatement({
            id,
            projectId: rule.projectId,
            automationId: rule.id,
            identity: id,
            kind: "guard",
            status: "committed",
            occurrenceId: occurrence.occurrenceId,
            ruleRevision: occurrence.ruleRevision,
            occurredAt: occurrence.occurredAt,
            replayUntil: occurrence.replayUntil,
            parentId: occurrence.id,
            runId: occurrence.runId,
            result: recorded,
            cursor: 0,
            queueAttempts: 0,
            rosterComplete: false,
            createdAt: now,
            updatedAt: now,
          }),
        ],
      );
      await this.cache.invalidateTable("automations");
      await this.cache.invalidateTable("automation_receipts");
      return recorded;
    });
  }
}

export interface AutomationGuardInput {
  rule: Automation;
  /**
   * The run's subgraph, and the condition node to decide.
   */
  graph?: AutomationGraphValue;
  node?: AutomationGraphNode;
  context: AutomationRunSnapshot["inputs"];
  variables: AutomationRunSnapshot["variables"];
}
export interface AutomationGuardResult {
  matched: boolean;
  noData: boolean;
  signature?: string;
  value?: number;
  previous?: number;
}
