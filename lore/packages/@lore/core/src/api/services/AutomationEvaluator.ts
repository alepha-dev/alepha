import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ForbiddenError } from "alepha/server";

import type { Automation } from "../entities/automations.ts";
import { automationEvaluationReportSchema } from "../schemas/automationEvaluationReportSchema.ts";
import type { AutomationRule } from "../schemas/automationRuleSchema.ts";
import type { AutomationRunSnapshot } from "../schemas/automationRunSnapshotSchema.ts";
import type { AutomationSourceProvenance } from "../schemas/automationSourceProvenanceSchema.ts";
import { AutomationTemplateBindings } from "../schemas/AutomationTemplateBindings.ts";
import {
  automationTestSourceSchema,
  type AutomationTestSource,
} from "../schemas/automationTestSourceSchema.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import {
  AutomationContextBuilder,
  type AutomationRenderContext,
} from "./AutomationContextBuilder.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationDependencies } from "./AutomationDependencies.ts";
import { AutomationDomainActions } from "./AutomationDomainActions.ts";
import { AutomationEventSubjects } from "./AutomationEventSubjects.ts";
import {
  AutomationGuards,
  type AutomationGuardResult,
} from "./AutomationGuards.ts";
import { AutomationNotifications } from "./AutomationNotifications.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import {
  AutomationRunEvidence,
  type AutomationPreparedEvidence,
} from "./AutomationRunEvidence.ts";
import {
  AutomationSelections,
  type AutomationSelected,
} from "./AutomationSelections.ts";
import { AutomationTemplateRenderer } from "./AutomationTemplateRenderer.ts";
import { AutomationVariables } from "./AutomationVariables.ts";

/**
 * Pure planning: all calls below read or render. Persistence and adapters that
 * perform effects are deliberately absent from this service's execution path.
 */
export class AutomationEvaluator {
  protected readonly database = $inject(AutomationDatabase);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly access = $inject(AutomationAccess);
  protected readonly dependencies = $inject(AutomationDependencies);
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly builder = $inject(AutomationContextBuilder);
  protected readonly subjects = $inject(AutomationEventSubjects);
  protected readonly variables = $inject(AutomationVariables);
  protected readonly selections = $inject(AutomationSelections);
  protected readonly guards = $inject(AutomationGuards);
  protected readonly renderer = $inject(AutomationTemplateRenderer);
  protected readonly notifications = $inject(AutomationNotifications);
  protected readonly domain = $inject(AutomationDomainActions);
  protected readonly evidence = $inject(AutomationRunEvidence);
  protected readonly bindings = $inject(AutomationTemplateBindings);
  protected readonly time = $inject(DateTimeProvider);

  public async test(
    id: string,
    caller: UserAccountToken,
    source?: AutomationTestSource,
  ) {
    return this.database.primary(async () => {
      const rule = await this.persistence.rules.getById(id);
      await this.access.assert(rule.projectId, caller, "automation:read");
      const reason = await this.catalog.sourceAvailability(
        rule.projectId,
        caller,
        rule.rule,
      );
      if (reason)
        throw new ForbiddenError("Current source access is unavailable");
      const evaluation = await this.evaluate({
        rule,
        source,
        disclosureUser: caller,
      });
      return this.report(evaluation);
    });
  }
  public async evaluate(input: {
    rule: Automation;
    source?: AutomationTestSource;
    liveSource?: {
      fields: Record<string, unknown>;
      provenance: AutomationSourceProvenance;
    };
    disclosureUser?: UserAccountToken;
    evaluatedAt?: string;
    cursor?: AutomationRunSnapshot["selectionNext"];
  }): Promise<AutomationEvaluation> {
    return this.database.primary(async () => {
      const evaluatedAt = input.evaluatedAt ?? this.time.nowISOString();
      const base: AutomationEvaluation = {
        rule: input.rule,
        evaluatedAt,
        variables: [],
        selected: [],
        contexts: [],
        guards: [],
        operations: [],
        matched: 0,
        total: 0,
        totalIsExact: true,
        hasMore: false,
        truncated: false,
        noData: false,
      };
      try {
        if (!Number.isFinite(new Date(evaluatedAt).getTime()))
          throw new BadRequestError("Invalid evaluation time");
        await this.dependencies.assert(input.rule);
        const user = await this.access.author(input.rule);
        await this.access.assert(
          input.rule.projectId,
          user,
          "automation:write",
        );
        base.variables = await this.variables.snapshot(input.rule, user, {
          transition: false,
        });
        const rows = base.variables;
        if (input.disclosureUser)
          for (const row of rows)
            if (
              !(
                await this.catalog.inspectVariable(
                  input.rule.projectId,
                  input.disclosureUser,
                  { ...row, projectId: input.rule.projectId } as Parameters<
                    AutomationCatalog["inspectVariable"]
                  >[2],
                )
              ).available
            )
              throw new ForbiddenError("Variable source access is unavailable");
        let selected: AutomationSelected;
        if (input.rule.rule.trigger.kind === "event") {
          const source =
            input.liveSource ??
            (input.source
              ? await this.subjects.resolve(
                  input.rule,
                  automationTestSourceSchema.parse(input.source),
                )
              : undefined);
          if (!source)
            throw new BadRequestError(
              "Choose a typed same-project event subject or retained snapshot",
            );
          if (source.provenance.key !== input.rule.rule.trigger.event)
            throw new BadRequestError("Event source does not match this rule");
          base.source = source.provenance;
          const context = await this.builder.source(
            input.rule.projectId,
            source.provenance.key,
            source.fields,
          );
          const filter = input.rule.rule.trigger.app;
          const filtered =
            filter !== undefined &&
            this.bindings.resolve({
              slot: { kind: "text", required: true },
              value: filter,
              fields: {},
              variables: new Map(
                base.variables.map((row) => [
                  row.key,
                  { kind: row.value.kind, available: true, value: row.value },
                ]),
              ),
              path: "trigger.app",
            }).value !== context.values.app;
          selected = {
            kind: "scalar",
            contexts: filtered ? [] : [context],
            items: filtered ? [] : [context.values],
            total: filtered ? 0 : 1,
            totalIsExact: true,
            hasMore: false,
            truncated: false,
            noData: false,
            evaluatedAt,
          };
        } else {
          if (input.source || input.liveSource)
            throw new BadRequestError(
              "Scheduled rules do not accept event subjects",
            );
          selected = await this.selections.evaluate({
            rule: input.rule,
            user,
            variables: base.variables,
            evaluatedAt,
            cursor: input.cursor,
          });
          base.source = { mode: "schedule", key: input.rule.rule.select!.key };
        }
        Object.assign(base, {
          selected: selected.items,
          contexts: selected.contexts,
          total: selected.total,
          totalIsExact: selected.totalIsExact,
          hasMore: selected.hasMore,
          truncated: selected.truncated,
          noData: selected.noData,
          next: selected.next,
        });
        for (const [row, context] of selected.contexts.entries()) {
          const guard = selected.noData
            ? { matched: false, noData: true }
            : await this.guards.evaluate({
                rule: input.rule,
                context: context.values,
                variables: base.variables,
              });
          base.guards.push(guard);
          base.noData ||= guard.noData;
          if (
            !guard.matched ||
            (selected.kind === "collection" && !selected.items.length)
          )
            continue;
          base.matched +=
            selected.kind === "collection" ? selected.items.length : 1;
          for (const [index, action] of input.rule.rule.actions.entries()) {
            const position = {
              index,
              ...(selected.kind === "rows" ? { row } : {}),
            };
            const rendered = this.renderer.render(
              action,
              context,
              base.variables,
            );
            let operation: AutomationPlannedOperation = {
              ...position,
              action: rendered.raw,
              rendered: rendered.action,
              bytes: rendered.bytes,
              lang: "en",
              skipped: rendered.suppressed,
              truncated: rendered.truncated,
              changed: !rendered.suppressed,
            };
            if (!rendered.suppressed) {
              await this.catalog.validateEffect(
                input.rule.rule,
                input.rule.projectId,
                user,
                rendered.raw,
              );
              if (action.kind === "notify") {
                const prepared = await this.notifications.prepare({
                  rule: input.rule,
                  index,
                  action,
                  context,
                  variables: base.variables,
                });
                operation = {
                  ...operation,
                  rendered: prepared.rendered.action,
                  action: prepared.rendered.raw,
                  bytes: prepared.rendered.bytes,
                  truncated: prepared.rendered.truncated,
                  skipped: prepared.skipped,
                  changed: !prepared.skipped,
                  ...(prepared.skipped
                    ? { reason: prepared.reason }
                    : {
                        delivery: {
                          title: prepared.payload.variables.title,
                          text: prepared.payload.variables.text,
                          html: prepared.payload.variables.html,
                        },
                      }),
                };
              } else {
                const preview = await this.domain.preview({
                  rule: input.rule,
                  user,
                  action: rendered.raw as Exclude<
                    AutomationRule["actions"][number],
                    { kind: "notify" }
                  >,
                });
                operation.changed = preview.changed;
              }
            }
            base.truncated ||= operation.truncated;
            base.operations.push(operation);
          }
        }
        const prepared = await this.prepare(base);
        base.prepared = prepared;
        if (prepared.status === "refused") {
          base.refusal = prepared.reason;
          base.operations = [];
        }
      } catch (error) {
        base.refusal = (
          error instanceof Error
            ? error.message
            : "Automation evaluation refused"
        ).slice(0, 1024);
        // A permission refusal must not disclose partial selected inputs or a
        // shared value collected before the refusing gate finished.
        base.variables = [];
        base.selected = [];
        base.contexts = [];
        base.operations = [];
        base.guards = [];
        base.matched = 0;
        base.total = 0;
        base.prepared = await this.prepare(base);
      }
      return base;
    });
  }
  public async prepare(
    evaluation: AutomationEvaluation,
  ): Promise<AutomationPreparedEvidence> {
    const prepared = await this.evidence.prepare({
      rule: evaluation.rule,
      occurrenceId: "preview",
      triggeredAt: evaluation.evaluatedAt,
      evaluatedAt: evaluation.evaluatedAt,
      source: evaluation.source,
      selectionNext: evaluation.next,
      noData: evaluation.noData,
      inputs: evaluation.contexts[0]?.values ?? {},
      selected: evaluation.selected,
      variables: evaluation.variables,
      matched: evaluation.matched,
      total: evaluation.total,
      totalIsExact: evaluation.totalIsExact,
      hasMore: evaluation.hasMore,
      planned: evaluation.operations.map(({ index, row }) => ({
        index,
        ...(row !== undefined ? { row } : {}),
      })),
      ...(evaluation.refusal
        ? { status: "refused", reason: evaluation.refusal }
        : {}),
    });
    prepared.snapshot.counts.truncated ||= evaluation.truncated;
    return prepared;
  }
  public report(evaluation: AutomationEvaluation) {
    const snapshot = evaluation.prepared!.snapshot;
    const report = {
      evaluatedAt: evaluation.evaluatedAt,
      preview: true as const,
      status: evaluation.refusal ? ("refused" as const) : ("preview" as const),
      ...(evaluation.refusal ? { reason: evaluation.refusal } : {}),
      source: evaluation.source,
      inputs: snapshot.inputs,
      variables: snapshot.variables,
      selected: snapshot.selected,
      counts: {
        ...snapshot.counts,
        truncated: evaluation.truncated || snapshot.counts.truncated,
      },
      noData: evaluation.noData,
      guards: evaluation.guards,
      operations: [] as AutomationPlannedOperation[],
      operationsOmitted: 0,
      disclaimer:
        "Preview at evaluatedAt. Notifications are planned enqueues, not delivery confirmations. Live data, permissions and preferences can change.",
    };
    for (const operation of evaluation.operations) {
      report.operations.push(operation);
      if (
        new TextEncoder().encode(JSON.stringify(report)).byteLength > 65_000
      ) {
        report.operations.pop();
        report.operationsOmitted++;
      }
    }
    report.counts.truncated ||= report.operationsOmitted > 0;
    return automationEvaluationReportSchema.parse(report);
  }
}
export interface AutomationPlannedOperation {
  index: number;
  row?: number;
  action: AutomationRule["actions"][number];
  rendered: AutomationRule["actions"][number];
  bytes: number;
  delivery?: { title: string; text: string; html: string };
  lang: "en";
  skipped: boolean;
  changed: boolean;
  reason?: string;
  truncated: boolean;
}
export interface AutomationEvaluation {
  rule: Automation;
  evaluatedAt: string;
  variables: AutomationRunSnapshot["variables"];
  source?: AutomationSourceProvenance;
  selected: AutomationRunSnapshot["selected"];
  contexts: AutomationRenderContext[];
  guards: AutomationGuardResult[];
  operations: AutomationPlannedOperation[];
  prepared?: AutomationPreparedEvidence;
  matched: number;
  total: number;
  totalIsExact: boolean;
  hasMore: boolean;
  truncated: boolean;
  noData: boolean;
  next?: AutomationRunSnapshot["selectionNext"];
  refusal?: string;
}
