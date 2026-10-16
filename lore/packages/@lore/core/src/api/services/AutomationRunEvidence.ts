import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { DbCacheProvider, sql, type SQLLike } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ConflictError } from "alepha/server";

import type { AutomationRun } from "../entities/automationRuns.ts";
import { automationRuns } from "../entities/automationRuns.ts";
import { automations, type Automation } from "../entities/automations.ts";
import {
  automationRunSnapshotSchema,
  type AutomationRunSnapshot,
} from "../schemas/automationRunSnapshotSchema.ts";
import type { AutomationSlotKind } from "../schemas/automationSlotKindSchema.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationBatchRepository } from "./AutomationBatchRepository.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationConfigurationWrites } from "./AutomationConfigurationWrites.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";

/**
 * Evidence is committed before any effect. A receipt/outbox ID records enqueue
 * intent, not transport delivery. Durable occurrence/effect receipts live in a
 * separate store and are never removed by the detail retention sweep.
 */
export class AutomationRunEvidence {
  protected readonly database = $inject(AutomationDatabase);
  protected readonly writes = $inject(AutomationConfigurationWrites);
  protected readonly cache = $inject(DbCacheProvider);
  protected readonly ruleRows = $inject(
    AutomationBatchRepository.of(automations),
  );
  protected readonly runRows = $inject(
    AutomationBatchRepository.of(automationRuns),
  );
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly access = $inject(AutomationAccess);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly terminal: AutomationRun["status"][] = [
    "succeeded",
    "skipped",
    "refused",
    "partial",
    "failed",
    "unknown",
  ];
  protected readonly resultFields: Record<string, string[]> = {
    notify: [
      "outbox_ids",
      "notification_id",
      "outbox_id",
      "enqueued",
      "delivered",
      "skipped",
      "reason",
    ],
    appendFolio: ["folio_id", "revision", "changed"],
    createQuest: ["quest_id", "shortId", "changed"],
    assignRelease: ["quest_id", "release_id", "changed"],
    addTag: ["quest_id", "tag", "changed"],
  };

  public async start(input: AutomationEvidenceInput): Promise<AutomationRun> {
    const prepared = await this.prepare(input);
    return this.persist({ ...input, prepared });
  }

  public async persist(input: {
    id?: string;
    rule: Automation;
    occurrenceId: string;
    triggeredAt: string;
    prepared: AutomationPreparedEvidence;
  }): Promise<AutomationRun> {
    if (input.id) {
      const existing = await this.persistence.runs.findById(input.id);
      if (existing) {
        if (
          existing.automationId !== input.rule.id ||
          existing.projectId !== input.rule.projectId ||
          existing.occurrenceId !== input.occurrenceId ||
          existing.ruleRevision !== input.rule.revision
        )
          throw new ConflictError(
            "Run identity does not match the durable claim",
          );
        return existing;
      }
    }
    const { snapshot, status, reason } = input.prepared;
    try {
      return await this.persistence.runs.create({
        ...(input.id ? { id: input.id } : {}),
        projectId: input.rule.projectId,
        automationId: input.rule.id,
        ruleRevision: input.rule.revision,
        occurrenceId: input.occurrenceId,
        triggeredAt: input.triggeredAt,
        status,
        ...(reason ? { reason: reason.slice(0, 1024) } : {}),
        snapshot: automationRunSnapshotSchema.parse(snapshot),
        ...(this.terminal.includes(status)
          ? { finishedAt: this.dateTime.nowISOString() }
          : {}),
      });
    } catch (error) {
      if (input.id) {
        const existing = await this.persistence.runs.findById(input.id);
        if (
          existing &&
          existing.automationId === input.rule.id &&
          existing.occurrenceId === input.occurrenceId &&
          existing.ruleRevision === input.rule.revision
        )
          return existing;
      }
      throw error;
    }
  }

  public async prepare(
    input: AutomationEvidenceInput,
  ): Promise<AutomationPreparedEvidence> {
    const rule = input.rule;
    const key =
      rule.rule.trigger.kind === "event"
        ? rule.rule.trigger.event
        : rule.rule.select!.key;
    const descriptor = this.catalog.entries().find((item) => item.key === key);
    const fields = descriptor?.fields ?? {};
    const rows = input.selected ?? [];
    const selected = rows
      .slice(0, 50)
      .map((row) => this.safe(row, descriptor?.itemFields ?? fields));
    const hasMore =
      !!input.hasMore ||
      rows.length > 50 ||
      (input.total !== undefined && input.total > selected.length);
    const total =
      input.total ?? Math.max(rows.length, selected.length + (hasMore ? 1 : 0));
    if (
      !Number.isSafeInteger(total) ||
      total < rows.length ||
      (hasMore && total <= selected.length)
    )
      throw new BadRequestError(
        "Selection totals contradict the observed lower bound",
      );
    const matched = input.matched ?? 0;
    if (
      !Number.isSafeInteger(matched) ||
      matched < 0 ||
      matched > selected.length
    )
      throw new BadRequestError(
        "Matched count must be within the selected rows",
      );
    const planned = input.planned ?? [];
    if (planned.length > 250)
      throw new BadRequestError(
        "At most 250 row/action positions may be planned",
      );
    const referenced = this.catalog.names(rule.rule);
    const perRow = rule.rule.select?.kind === "rows";
    if (
      planned.some((action) =>
        perRow ? action.row === undefined : action.row !== undefined,
      ) ||
      planned.length >
        (perRow ? matched : matched ? 1 : 0) * rule.rule.actions.length ||
      (perRow && new Set(planned.map((action) => action.row)).size > matched)
    )
      throw new BadRequestError(
        "Planned effects do not match selection cardinality and matched count",
      );
    const identities = new Set(
      planned.map((action) => `${action.row ?? -1}:${action.index}`),
    );
    if (
      identities.size !== planned.length ||
      planned.some(
        (action) =>
          !rule.rule.actions[action.index] ||
          (action.row !== undefined && !selected[action.row]),
      )
    )
      throw new BadRequestError(
        "Planned actions must identify distinct selected row/action positions",
      );
    const snapshot: AutomationRunSnapshot = {
      rule: rule.rule,
      ruleHash: await this.hash(rule.rule),
      evaluatedAt: input.evaluatedAt ?? this.dateTime.nowISOString(),
      ...(input.health ? { health: input.health } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.selectionNext ? { selectionNext: input.selectionNext } : {}),
      ...(input.noData !== undefined ? { noData: input.noData } : {}),
      inputs: this.safe(input.inputs ?? {}, fields),
      variables: (input.variables ?? []).filter((variable) =>
        referenced.has(variable.key),
      ),
      selected,
      counts: {
        selected: selected.length,
        matched,
        executed: 0,
        deliveries: 0,
        skipped: selected.length - matched,
        total,
        totalIsExact: input.total !== undefined && input.totalIsExact !== false,
        truncated: hasMore,
        hasMore,
      },
      actions: planned.map((action) => ({
        ...action,
        status: "pending",
        result: {},
      })),
    };
    let status = input.status ?? "queued";
    let reason = input.reason;
    // Reserve the minimal status and receipt for every planned outcome before
    // effects. Large optional result details may later be explicitly omitted.
    if (
      !automationRunSnapshotSchema.safeParse(this.reserved(snapshot)).success
    ) {
      status = "refused";
      reason = "Run snapshot exceeds the 64 KiB evidence budget";
      snapshot.rule = null;
      snapshot.inputs = {};
      snapshot.variables = [];
      snapshot.selected = [];
      snapshot.actions = [];
      snapshot.omitted =
        "Snapshot budget exceeded before effects; rule hash and revision retained";
    }
    return {
      snapshot: automationRunSnapshotSchema.parse(snapshot),
      status,
      ...(reason ? { reason } : {}),
    };
  }

  public async continueInAnotherRun(id: string): Promise<void> {
    const run = await this.persistence.runs.getById(id);
    if (this.terminal.includes(run.status)) return;
    if (run.snapshot.actions.some((action) => action.status === "running"))
      throw new ConflictError(
        "An in-flight action must be reconciled before continuation",
      );
    const snapshot = structuredClone(run.snapshot);
    for (const action of snapshot.actions)
      if (action.status === "pending") {
        action.status = "skipped";
        action.result = { reason: "Continued in another run" };
      }
    snapshot.counts.hasMore = true;
    await this.persistence.runs.updateById(id, {
      version: run.version,
      snapshot,
      status:
        snapshot.counts.executed || snapshot.counts.deliveries
          ? "succeeded"
          : "skipped",
      reason: "Continued in another run",
      finishedAt: this.dateTime.nowISOString(),
    });
  }

  public async assertDeliveryBudget(
    id: string,
    deliveries: number,
  ): Promise<void> {
    const run = await this.persistence.runs.getById(id);
    if (this.terminal.includes(run.status))
      throw new ConflictError("Run is terminal");
    if (
      !Number.isSafeInteger(deliveries) ||
      deliveries < 0 ||
      run.snapshot.counts.deliveries + deliveries > 100
    )
      throw new BadRequestError("Run delivery budget exceeds 100");
  }

  public async truncated(id: string): Promise<void> {
    const run = await this.persistence.runs.getById(id);
    if (run.snapshot.counts.truncated) return;
    const snapshot = structuredClone(run.snapshot);
    snapshot.counts.truncated = true;
    await this.persistence.runs.updateById(id, {
      version: run.version,
      snapshot,
    });
  }

  public async action(
    id: string,
    input: {
      index: number;
      row?: number;
      status: AutomationRunSnapshot["actions"][number]["status"];
      result?: Record<string, unknown>;
      receiptId?: string;
      deliveries?: number;
      aggregate?: boolean;
    },
  ): Promise<AutomationRun> {
    const run = await this.persistence.runs.getById(id);
    if (this.terminal.includes(run.status) || !run.snapshot.rule)
      throw new ConflictError("A terminal run cannot execute another action");
    const position = run.snapshot.actions.findIndex(
      (action) => action.index === input.index && action.row === input.row,
    );
    const previous = run.snapshot.actions[position];
    if (!previous)
      throw new BadRequestError("Action was not planned before effects");
    if (!["pending", "running"].includes(previous.status)) {
      if (
        input.aggregate &&
        previous.status === "queued" &&
        previous.receiptId === input.receiptId
      ) {
        if (
          !input.deliveries &&
          JSON.stringify(previous.result) === JSON.stringify(input.result ?? {})
        )
          return run;
      } else if (
        previous.status === input.status &&
        previous.receiptId === input.receiptId
      )
        return run;
      else throw new ConflictError("Action already has a terminal outcome");
    }
    if (previous.status === "running" && input.status === "pending")
      throw new ConflictError("An action cannot return to pending");
    const deliveries = input.deliveries ?? 0;
    if (
      !Number.isSafeInteger(deliveries) ||
      deliveries < 0 ||
      run.snapshot.counts.deliveries + deliveries > 100
    )
      throw new BadRequestError("Run delivery budget exceeds 100");
    if (deliveries && ["pending", "running", "skipped"].includes(input.status))
      throw new BadRequestError(
        "Only terminal outcomes may include committed/enqueued delivery counts",
      );
    if (input.receiptId && input.receiptId.length > 64)
      throw new BadRequestError(
        "Receipt identifier exceeds the reserved evidence budget",
      );
    const kind = run.snapshot.rule.actions[input.index].kind;
    const result = this.safeResult(kind, input.result ?? {});
    if (kind === "notify" && input.status === "queued") {
      result.enqueued = true;
      result.delivered = false;
    }
    const snapshot = structuredClone(run.snapshot);
    snapshot.actions[position] = {
      index: input.index,
      ...(input.row !== undefined ? { row: input.row } : {}),
      status: input.status,
      result,
      ...(input.receiptId ? { receiptId: input.receiptId } : {}),
    };
    snapshot.counts.executed = snapshot.actions.filter((action) =>
      ["queued", "succeeded"].includes(action.status),
    ).length;
    snapshot.counts.deliveries += deliveries;
    if (!automationRunSnapshotSchema.safeParse(this.reserved(snapshot)).success)
      snapshot.actions[position].result = { omitted: true };
    return this.persistence.runs.updateById(id, {
      version: run.version,
      status: "running",
      snapshot: automationRunSnapshotSchema.parse(snapshot),
    });
  }

  public async finish(id: string, reason?: string): Promise<AutomationRun> {
    const run = await this.persistence.runs.getById(id);
    if (this.terminal.includes(run.status)) return run;
    const statuses = run.snapshot.actions.map((action) => action.status);
    const problem = statuses.includes("unknown")
      ? "unknown"
      : statuses.includes("failed")
        ? "failed"
        : statuses.includes("refused")
          ? "refused"
          : undefined;
    if (
      !problem &&
      statuses.some((status) => status === "running" || status === "pending")
    )
      throw new ConflictError("Run still has unfinished actions");
    if (problem) {
      for (const action of run.snapshot.actions)
        if (action.status === "pending") {
          action.status = "skipped";
          action.result = {
            reason: "Stopped after an earlier unsuccessful action",
          };
        }
    }
    const status =
      problem === "unknown"
        ? "unknown"
        : problem
          ? run.snapshot.counts.executed || run.snapshot.counts.deliveries
            ? "partial"
            : problem
          : run.snapshot.counts.executed
            ? "succeeded"
            : "skipped";
    const finished = await this.persistence.runs.updateById(id, {
      version: run.version,
      status,
      snapshot: automationRunSnapshotSchema.parse(run.snapshot),
      finishedAt: this.dateTime.nowISOString(),
      ...(reason ? { reason: reason.slice(0, 1024) } : {}),
    });
    if (status === "unknown")
      await this.transition(
        run.automationId,
        "paused",
        "An action outcome is unknown; author review is required",
        true,
      );
    return finished;
  }

  public async transition(
    ruleId: string,
    health: Automation["health"],
    reason: string | undefined,
    requiresApproval: boolean,
    options: {
      expectedVersion?: number;
      condition?: SQLLike;
      statements?: SQLLike[];
      changedTables?: string[];
      patch?: Partial<
        Pick<
          Automation,
          "enabled" | "revision" | "approvedVariables" | "title" | "rule"
        >
      > & {
        authorKeyId?: string | null;
        authorSessionId?: string | null;
        authorScope?: string[] | null;
        activatedAt?: string | null;
        baseline?: Automation["baseline"] | null;
      } & {
        nextRunAt?: string | null;
        scheduleCron?: string | null;
      };
    } = {},
  ): Promise<boolean> {
    return this.database.primary(async () => {
      reason = reason?.slice(0, 1024);
      const rule = await this.persistence.rules.getById(ruleId);
      if (
        options.expectedVersion !== undefined &&
        rule.version !== options.expectedVersion
      )
        return false;
      const patch = options.patch ?? {};
      if (
        rule.health === health &&
        rule.reason === reason &&
        rule.requiresApproval === requiresApproval &&
        Object.entries(patch).every(
          ([key, value]) => rule[key as keyof Automation] === value,
        )
      )
        return false;
      const now = this.dateTime.nowISOString();
      const prepared = await this.prepare({
        rule,
        occurrenceId: "health",
        triggeredAt: now,
        status: health === "active" ? "skipped" : "refused",
        reason:
          reason ??
          (patch.enabled === false
            ? "Automation disabled"
            : "Automation health restored"),
        health: { from: rule.health, to: health },
      });
      try {
        await this.writes.commit(
          rule.projectId,
          sql`${this.ruleRows.exists({ id: rule.id, version: rule.version })} ${options.condition ? sql`AND (${typeof options.condition === "string" ? sql.raw(options.condition) : options.condition.getSQL()})` : sql``}`,
          [
            this.ruleRows.updateStatement(
              { id: rule.id, version: rule.version },
              {
                ...patch,
                health,
                reason: reason ?? null,
                requiresApproval,
                updatedAt: now,
              },
            ),
            this.runRows.insertStatement({
              projectId: rule.projectId,
              automationId: rule.id,
              ruleRevision: patch.revision ?? rule.revision,
              occurrenceId: `health:${crypto.randomUUID()}`,
              triggeredAt: now,
              finishedAt: now,
              status: prepared.status,
              reason: prepared.reason,
              snapshot: prepared.snapshot,
            }),
            ...(options.statements ?? []),
          ],
        );
      } catch (error) {
        const latest = await this.persistence.rules.findById(rule.id);
        if (!latest || latest.version !== rule.version) return false;
        throw error;
      }
      await this.cache.invalidateTable("automations");
      await this.cache.invalidateTable("automation_runs");
      for (const table of options.changedTables ?? [])
        await this.cache.invalidateTable(table);
      return true;
    });
  }

  public async read(id: string, user: UserAccountToken) {
    const run = await this.persistence.runs.getById(id);
    await this.access.assert(run.projectId, user, "automation:read");
    const rule =
      run.snapshot.rule ??
      (await this.persistence.rules.getById(run.automationId, { force: true }))
        .rule;
    let reason = await this.catalog.sourceAvailability(
      run.projectId,
      user,
      rule,
    );
    if (!reason) {
      for (const variable of run.snapshot.variables) {
        const inspected = await this.catalog.inspectVariable(
          run.projectId,
          user,
          { ...variable, projectId: run.projectId } as Parameters<
            AutomationCatalog["inspectVariable"]
          >[2],
        );
        if (!inspected.available) {
          reason = "Variable source access is unavailable";
          break;
        }
      }
    }
    return {
      ...run,
      snapshot: reason ? null : run.snapshot,
      redacted: !!reason,
      ...(reason
        ? { redactionReason: "Current source access is unavailable" }
        : {}),
    };
  }

  public async prune(): Promise<number> {
    const cutoff = this.dateTime.now().subtract(30, "days").toISOString();
    const rows = await this.persistence.runs.findMany({
      where: { status: { inArray: this.terminal }, finishedAt: { lt: cutoff } },
      orderBy: [
        { column: "finishedAt", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
      columns: ["id"],
      limit: 100,
    });
    if (!rows.length) return 0;
    return (
      await this.persistence.runs.deleteMany({
        id: { inArray: rows.map((row) => row.id) },
        status: { inArray: this.terminal },
        finishedAt: { lt: cutoff },
      })
    ).length;
  }

  protected reserved(snapshot: AutomationRunSnapshot): AutomationRunSnapshot {
    return {
      ...snapshot,
      counts: { ...snapshot.counts, executed: 250, deliveries: 100 },
      actions: snapshot.actions.map((action) =>
        ["pending", "running"].includes(action.status)
          ? {
              ...action,
              status: "succeeded",
              receiptId: "x".repeat(64),
              result: { omitted: true },
            }
          : action,
      ),
    };
  }

  protected safe(
    input: Record<string, unknown>,
    fields: Record<string, AutomationSlotKind>,
  ): AutomationRunSnapshot["inputs"] {
    const result: AutomationRunSnapshot["inputs"] = {};
    for (const [key, value] of Object.entries(input)) {
      if (!Object.hasOwn(fields, key)) continue;
      const kind = fields[key];
      if (
        value === null ||
        (typeof value === "string" &&
          !["number", "boolean", "release", "textArray"].includes(kind)) ||
        (typeof value === "number" &&
          Number.isFinite(value) &&
          ["number", "release"].includes(kind)) ||
        (typeof value === "boolean" && kind === "boolean")
      )
        result[key] = value;
    }
    return result;
  }

  protected safeResult(
    kind: string,
    input: Record<string, unknown>,
  ): AutomationRunSnapshot["inputs"] {
    const result: AutomationRunSnapshot["inputs"] = {};
    for (const key of this.resultFields[kind] ?? []) {
      const value = input[key];
      if (
        (typeof value === "string" &&
          value.length <= (key === "outbox_ids" ? 8_000 : 255)) ||
        (typeof value === "number" && Number.isFinite(value)) ||
        typeof value === "boolean"
      )
        result[key] = value;
    }
    return result;
  }

  protected async hash(value: unknown): Promise<string> {
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(value)),
    );
    return [...new Uint8Array(bytes)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
}

export interface AutomationEvidenceInput {
  id?: string;
  rule: Automation;
  occurrenceId: string;
  triggeredAt: string;
  evaluatedAt?: string;
  source?: AutomationRunSnapshot["source"];
  selectionNext?: AutomationRunSnapshot["selectionNext"];
  noData?: boolean;
  inputs?: Record<string, unknown>;
  selected?: Record<string, unknown>[];
  variables?: AutomationRunSnapshot["variables"];
  matched?: number;
  total?: number;
  totalIsExact?: boolean;
  hasMore?: boolean;
  planned?: Array<{ index: number; row?: number }>;
  status?: AutomationRun["status"];
  reason?: string;
  health?: AutomationRunSnapshot["health"];
}

export interface AutomationPreparedEvidence {
  snapshot: AutomationRunSnapshot;
  status: AutomationRun["status"];
  reason?: string;
}
