import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ForbiddenError } from "alepha/server";

import type { Automation } from "../entities/automations.ts";
import type { AutomationAudiencePreview } from "../schemas/automationAudiencePreviewSchema.ts";
import { automationEvaluationReportSchema } from "../schemas/automationEvaluationReportSchema.ts";
import { AutomationGraph } from "../schemas/AutomationGraph.ts";
import type { AutomationGraphOutput } from "../schemas/AutomationGraph.ts";
import type { AutomationGraphValue } from "../schemas/automationGraphSchema.ts";
import type { AutomationRule } from "../schemas/automationRuleSchema.ts";
import type { AutomationRunSnapshot } from "../schemas/automationRunSnapshotSchema.ts";
import type { AutomationSourceProvenance } from "../schemas/automationSourceProvenanceSchema.ts";
import { AutomationTemplateBindings } from "../schemas/AutomationTemplateBindings.ts";
import { AutomationTemplateTokens } from "../schemas/AutomationTemplateTokens.ts";
import {
  automationTestSourceSchema,
  type AutomationTestSource,
} from "../schemas/automationTestSourceSchema.ts";
import { AutomationVocabulary } from "../schemas/AutomationVocabulary.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationAudience } from "./AutomationAudience.ts";
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
  protected readonly audience = $inject(AutomationAudience);
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
  protected readonly graphs = $inject(AutomationGraph);
  protected readonly tokens = $inject(AutomationTemplateTokens);

  public async test(
    id: string,
    caller: UserAccountToken,
    source?: AutomationTestSource,
    node?: string,
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
        node,
        disclosureUser: caller,
      });
      return this.report(evaluation);
    });
  }
  public async evaluate(input: {
    rule: Automation;
    /**
     * What the run walks: the subgraph its source reaches (#Q3804). Absent,
     * the stored rule's, from `node` or its first source.
     */
    graph?: AutomationGraphValue;
    node?: string;
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
      const whole = AutomationGraph.of(input.rule.rule);
      const node =
        input.graph?.nodes.find((item) => item.kind === "source")?.id ??
        this.graphs.source(whole, input.node).id;
      const graph = input.graph ?? this.graphs.subgraph(whole, node);
      const trigger = this.graphs.source(graph, node);
      const base: AutomationEvaluation = {
        rule: input.rule,
        graph,
        node,
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
          input.rule,
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
                  {
                    ...row,
                    projectId: input.rule.projectId,
                  } as Parameters<AutomationCatalog["inspectVariable"]>[2],
                )
              ).available
            )
              throw new ForbiddenError("Variable source access is unavailable");
        let selected: AutomationSelected;
        if (trigger.type !== AutomationVocabulary.SCHEDULE) {
          const source =
            input.liveSource ??
            (input.source
              ? await this.subjects.resolve(
                  input.rule,
                  automationTestSourceSchema.parse(input.source),
                  node,
                )
              : undefined);
          if (!source)
            throw new BadRequestError(
              "Choose a typed same-project event subject or retained snapshot",
            );
          if (source.provenance.key !== trigger.type)
            throw new BadRequestError("Event source does not match this rule");
          base.source = source.provenance;
          const context = await this.builder.source(
            input.rule.projectId,
            source.provenance.key,
            source.fields,
          );
          // `app` filters deploy.*, `monitor` filters monitor.* (#Q3610).
          const filters = trigger.config as Record<string, string | undefined>;
          const variables = new Map(
            base.variables.map((row) => [
              row.key,
              { kind: row.value.kind, available: true, value: row.value },
            ]),
          );
          const filtered = (["app", "monitor", "host"] as const).some(
            (name) => {
              const filter = filters[name];
              return (
                filter !== undefined &&
                this.bindings.resolve({
                  slot: { kind: "text", required: true },
                  value: filter,
                  fields: {},
                  variables,
                  path: `trigger.${name}`,
                }).value !==
                  (name === "monitor"
                    ? context.values.monitor_id
                    : name === "host"
                      ? context.values.host_id
                      : context.values.app)
              );
            },
          );
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
            graph,
            user,
            variables: base.variables,
            evaluatedAt,
            cursor: input.cursor,
          });
          base.source = {
            mode: "schedule",
            key: this.graphs.sourceKey(graph, node),
          };
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
        const steps = this.graphs.steps(graph, node);
        for (const [row, context] of selected.contexts.entries()) {
          // Every condition is decided before the first effect, so the walk
          // is a plan (#Q3804): the run goes down the port each one takes.
          const decided = new Map<string, AutomationGuardResult>();
          for (const condition of this.graphs.conditions(graph))
            decided.set(
              condition.id,
              selected.noData
                ? { matched: false, noData: true }
                : await this.guards.evaluate({
                    rule: input.rule,
                    graph,
                    node: condition,
                    context: context.values,
                    variables: base.variables,
                  }),
            );
          const walk = this.graphs.walk(graph, node, (condition) => {
            const result = decided.get(condition.id)!;
            return result.noData
              ? undefined
              : result.matched
                ? "true"
                : "false";
          });
          for (const decision of walk.decisions) {
            const result = decided.get(decision.node)!;
            base.guards.push({
              node: decision.node,
              ...(selected.kind === "rows" ? { row } : {}),
              ...(decision.port ? { port: decision.port } : {}),
              ...result,
            });
            base.noData ||= result.noData;
          }
          const reached = steps.filter((step) => walk.reached.has(step.node));
          if (
            !reached.length ||
            (selected.kind === "collection" && !selected.items.length)
          )
            continue;
          base.matched +=
            selected.kind === "collection" ? selected.items.length : 1;
          for (const step of reached) {
            const action = this.graphs.action(graph, step);
            const position = {
              node: step.node,
              ...(step.channel !== undefined ? { channel: step.channel } : {}),
              ...(selected.kind === "rows" ? { row } : {}),
            };
            // A slot bound to an earlier action's output (#Q3814) has no
            // value before the run is real: it is reported, not validated.
            const outputs = this.graphs.outputs(
              graph,
              step.node,
              this.catalog.entries(),
            );
            const bound = this.tokens
              .inValue(action)
              .filter((name) => Object.hasOwn(outputs, name));
            if (bound.length) {
              base.operations.push(
                await this.deferred({
                  rule: input.rule,
                  graph,
                  node,
                  user,
                  action,
                  position,
                  context,
                  variables: base.variables,
                  outputs: Object.fromEntries(
                    bound.map((name) => [name, outputs[name]]),
                  ),
                }),
              );
              continue;
            }
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
                graph,
                input.rule.projectId,
                user,
                rendered.raw,
                input.rule,
                node,
              );
              if (action.kind === "notify" && action.audience) {
                if (input.disclosureUser) {
                  const reader = await this.access.authorize(
                    input.rule.projectId,
                    input.disclosureUser,
                    "automation:read",
                  );
                  if (!reader.permissions.includes("member:read"))
                    throw new ForbiddenError(
                      "Audience preview requires member:read",
                    );
                }
                const publisher =
                  base.source?.actorUserId ?? context.values.publisher_id;
                const audience = await this.audience.preview(
                  input.rule.projectId,
                  typeof publisher === "string" ? publisher : undefined,
                );
                operation = {
                  ...operation,
                  audience,
                  skipped: audience.total === 0,
                  changed: audience.total > 0,
                };
              } else if (action.kind === "notify") {
                const prepared = await this.notifications.prepare({
                  rule: input.rule,
                  node: step.node,
                  sourceNode: node,
                  sourceKey: this.graphs.sourceKey(graph, node),
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
        base.totalIsExact = true;
        base.hasMore = false;
        base.truncated = false;
        base.next = undefined;
        base.prepared = await this.prepare(base);
      }
      return base;
    });
  }
  /**
   * A step that names an earlier action's output, planned without it: its
   * other slots render and validate as any step's, its author's grant for
   * the action is checked, and the slots bound to an output keep their
   * placeholder, marked as known only when the run is real.
   */
  protected async deferred(input: {
    rule: Automation;
    graph: AutomationGraphValue;
    node: string;
    user: UserAccountToken;
    action: AutomationRule["actions"][number];
    position: Pick<AutomationPlannedOperation, "node" | "channel" | "row">;
    context: AutomationRenderContext;
    variables: AutomationRunSnapshot["variables"];
    outputs: Record<string, AutomationGraphOutput>;
  }): Promise<AutomationPlannedOperation> {
    const sentinel: Record<string, unknown> = {
      number: 1,
      release: 1,
      boolean: true,
      folio: "00000000-0000-4000-8000-000000000000",
      member: "00000000-0000-4000-8000-000000000000",
      textArray: [],
      channel: "inbox",
    };
    const rendered = this.renderer.render(
      input.action,
      {
        ...input.context,
        descriptor: {
          ...input.context.descriptor,
          fields: {
            ...input.context.descriptor.fields,
            ...Object.fromEntries(
              Object.entries(input.outputs).map(([name, output]) => [
                name,
                output.kind,
              ]),
            ),
          },
        },
        values: {
          ...input.context.values,
          ...Object.fromEntries(
            Object.entries(input.outputs).map(([name, output]) => [
              name,
              sentinel[output.kind] ?? "",
            ]),
          ),
        } as AutomationRenderContext["values"],
      },
      input.variables,
    );
    await this.catalog.validateEffect(
      input.graph,
      input.rule.projectId,
      input.user,
      rendered.raw,
      input.rule,
      input.node,
      false,
    );
    const unvalidated = Object.entries(input.action).flatMap(([slot, value]) =>
      slot !== "kind" &&
      this.tokens
        .inValue(value)
        .some((name) => Object.hasOwn(input.outputs, name))
        ? [slot]
        : [],
    );
    const keep = (action: AutomationRule["actions"][number]) =>
      ({
        ...action,
        ...Object.fromEntries(
          unvalidated.map((slot) => [
            slot,
            (input.action as unknown as Record<string, unknown>)[slot],
          ]),
        ),
      }) as AutomationRule["actions"][number];
    return {
      ...input.position,
      action: keep(rendered.raw),
      rendered: keep(rendered.action),
      bytes: rendered.bytes,
      lang: "en",
      skipped: false,
      changed: true,
      truncated: rendered.truncated,
      reason: `Known only when the run is real: ${Object.keys(input.outputs).join(", ")}`,
      unvalidated,
    };
  }

  public async prepare(
    evaluation: AutomationEvaluation,
  ): Promise<AutomationPreparedEvidence> {
    const prepared = await this.evidence.prepare({
      rule: evaluation.rule,
      node: evaluation.node,
      conditions: evaluation.guards.map(({ node, row, port }) => ({
        node,
        ...(row !== undefined ? { row } : {}),
        ...(port ? { port } : {}),
      })),
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
      planned: evaluation.operations.map(({ node, channel, row }) => ({
        node,
        ...(channel !== undefined ? { channel } : {}),
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
  node: string;
  channel?: string;
  row?: number;
  action: AutomationRule["actions"][number];
  rendered: AutomationRule["actions"][number];
  bytes: number;
  audience?: AutomationAudiencePreview;
  delivery?: { title: string; text: string; html: string };
  lang: "en";
  skipped: boolean;
  changed: boolean;
  reason?: string;
  truncated: boolean;
  /**
   * The slots bound to an earlier action's output, which only a real run
   * gives a value (#Q3814).
   */
  unvalidated?: string[];
}
export interface AutomationEvaluation {
  rule: Automation;
  /**
   * The subgraph the run walks, and the source it starts at.
   */
  graph: AutomationGraphValue;
  node: string;
  evaluatedAt: string;
  variables: AutomationRunSnapshot["variables"];
  source?: AutomationSourceProvenance;
  selected: AutomationRunSnapshot["selected"];
  contexts: AutomationRenderContext[];
  guards: Array<
    AutomationGuardResult & {
      node: string;
      row?: number;
      port?: "true" | "false";
    }
  >;
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
