import { $inject, type ZObject } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError } from "alepha/server";

import type { AutomationVariable } from "../entities/automationVariables.ts";
import type { AutomationAction } from "../schemas/automationActionSchema.ts";
import type { AutomationCatalogNodeType } from "../schemas/automationCatalogNodeTypeSchema.ts";
import { automationCatalogSchema } from "../schemas/automationCatalogSchema.ts";
import { AutomationCron } from "../schemas/AutomationCron.ts";
import type { AutomationDescriptor } from "../schemas/automationDescriptorSchema.ts";
import { AutomationGraph } from "../schemas/AutomationGraph.ts";
import {
  automationGraphSchema,
  type AutomationGraphValue,
} from "../schemas/automationGraphSchema.ts";
import type { AutomationGuard } from "../schemas/automationGuardSchema.ts";
import type { AutomationSlotKind } from "../schemas/automationSlotKindSchema.ts";
import type { AutomationSlot } from "../schemas/automationSlotSchema.ts";
import { AutomationTemplateBindings } from "../schemas/AutomationTemplateBindings.ts";
import { AutomationTemplateTokens } from "../schemas/AutomationTemplateTokens.ts";
import { AutomationVocabulary } from "../schemas/AutomationVocabulary.ts";
import { DashboardMetricCatalog } from "../schemas/DashboardMetricCatalog.ts";
import {
  AutomationAccess,
  type AutomationAccessSubject,
} from "./AutomationAccess.ts";
import { AutomationChannels } from "./AutomationChannels.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationPresetRegistry } from "./AutomationPresetRegistry.ts";
import { AutomationReferences } from "./AutomationReferences.ts";
import { CoreAutomationReferences } from "./CoreAutomationReferences.ts";
import { DashboardMetricRegistry } from "./DashboardMetricRegistry.ts";

/**
 * Authoring and execution use the same typed vocabulary and legality checks.
 * Feature-owned reference validators prove same-project identity, rather than
 * treating a resource description or an unfiltered ID lookup as authorization.
 */
export class AutomationCatalog {
  protected readonly presets = $inject(AutomationPresetRegistry);
  protected readonly access = $inject(AutomationAccess);
  protected readonly vocabulary = $inject(AutomationVocabulary);
  protected readonly metrics = $inject(DashboardMetricCatalog);
  protected readonly resolver = $inject(DashboardMetricRegistry);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly channels = $inject(AutomationChannels);
  protected readonly references = $inject(AutomationReferences);
  protected readonly coreReferences = $inject(CoreAutomationReferences);
  protected readonly cron = $inject(AutomationCron);
  protected readonly bindings = $inject(AutomationTemplateBindings);
  protected readonly tokens = $inject(AutomationTemplateTokens);
  protected readonly graphs = $inject(AutomationGraph);

  public entries(): AutomationDescriptor[] {
    return [
      ...this.vocabulary.all(),
      ...this.metrics
        .all()
        .filter((metric) => metric.automation?.kind === "number")
        .map((metric): AutomationDescriptor => ({
          key: metric.key,
          type: "metric",
          result: "scalar",
          fields: {
            ...this.vocabulary.commonFields(),
            value: "number",
            ...metric.automation!.fields,
          },
          slots: metric.automation!.slots,
          permissions: [
            ...new Set([
              metric.automation!.requires,
              ...(metric.requires ? [metric.requires] : []),
            ]),
          ],
          needs: metric.needs ? [metric.needs] : [],
          operators: metric.automation!.operators ?? [
            "eq",
            "ne",
            "lt",
            "lte",
            "gt",
            "gte",
            "crossesAbove",
          ],
        })),
    ];
  }

  /**
   * Every node type a graph may hold (#Q3805): each vocabulary entry as the
   * node it is (an event a source, a selection or a metric a read, an
   * action an action), and the two built-in types, `schedule` and
   * `compare`. Availability is the caller's, added by {@link describe}.
   */
  public nodeTypes(): Omit<
    AutomationCatalogNodeType,
    "available" | "reason"
  >[] {
    return [
      {
        type: AutomationVocabulary.SCHEDULE,
        kind: "source",
        ports: ["out"],
        fields: {},
        slots: { cron: { kind: "text", required: true, max: 128 } },
      },
      {
        type: AutomationVocabulary.COMPARE,
        kind: "condition",
        ports: ["true", "false"],
        fields: {},
        slots: {
          field: { kind: "text", required: true, bindable: false },
          operator: {
            kind: "text",
            required: true,
            bindable: false,
            values: [
              "eq",
              "ne",
              "lt",
              "lte",
              "gt",
              "gte",
              "delta",
              "crossesAbove",
            ],
          },
          value: { kind: "text", required: true },
        },
      },
      ...this.entries().map((entry) => ({
        type: entry.key,
        kind: (entry.type === "event"
          ? "source"
          : entry.type === "action"
            ? "action"
            : "read") as AutomationCatalogNodeType["kind"],
        ports: ["out" as const],
        fields: entry.fields,
        slots: entry.slots,
        ...(entry.outputs ? { outputs: entry.outputs } : {}),
      })),
    ];
  }

  public async describe(projectId: number, user: UserAccountToken) {
    const context = await this.access.authorize(
      projectId,
      user,
      "automation:read",
    );
    const rows = await this.persistence.variables.findMany({
      where: { projectId },
      orderBy: "key",
      limit: 101,
    });
    const variables = await Promise.all(
      rows.slice(0, 100).map((row) => this.variable(context, row)),
    );
    return automationCatalogSchema.parse({
      entries: this.entries().map((entry) => {
        const reason = this.unavailable(context, entry);
        return { ...entry, available: !reason, ...(reason ? { reason } : {}) };
      }),
      nodeTypes: this.nodeTypes().map((type) => {
        const entry = this.entries().find((item) => item.key === type.type);
        const reason = entry ? this.unavailable(context, entry) : undefined;
        return { ...type, available: !reason, ...(reason ? { reason } : {}) };
      }),
      presets: this.presets.all().map((preset) => {
        const reason = this.unavailable(context, {
          ...preset,
          type: "selection",
          result: "scalar",
          operators: [],
        });
        const sketch = this.presets.sketch(preset.key);
        return {
          ...preset,
          available: !reason,
          ...(reason ? { reason } : {}),
          ...(sketch ? { sketch } : {}),
        };
      }),
      variables,
      variablesHasMore: rows.length > 100,
      channels: await this.channels.all(projectId),
      limits: {
        selectedRows: 50,
        actions: 5,
        sources: AutomationGraph.MAX_SOURCES,
        nodes: AutomationGraph.MAX_NODES,
        actionsPerSource: AutomationGraph.MAX_ACTIONS_PER_SOURCE,
        deliveries: 100,
        renderedBytes: 16_384,
        snapshotBytes: 65_536,
        detailDays: 30,
        receiptDays: 90,
      },
    });
  }

  public async validate(
    ...args: Parameters<AutomationCatalog["compile"]>
  ): Promise<AutomationGraphValue> {
    return (await this.compile(...args)).rule;
  }

  /**
   * A graph as its author may store it (#Q3805): what `AutomationGraph`
   * checks (structure, the fields each node may use, the runner's bounds),
   * then each node's own checks: its entry is available to this author in
   * this project (sources included), its slots resolve, its targets exist.
   */
  public async compile(
    projectId: number,
    user: UserAccountToken,
    input: AutomationGraphValue,
    overrides: Map<string, AutomationVariable> = new Map(),
    subject?: AutomationAccessSubject,
    /**
     * `targets: false` checks the configuration without the domain rows it
     * names (a quest, a folio, a recipient's membership): what a run
     * re-checks before every step, since a target that vanished refuses
     * only its own step (#Q3804).
     */
    options: { targets?: boolean; skip?: ReadonlySet<string> } = {},
  ) {
    const targets = options.targets !== false;
    let scheduleCron: string | undefined;
    const parsedRule = automationGraphSchema.safeParse(input);
    if (!parsedRule.success)
      throw new BadRequestError(`rule: ${parsedRule.error.message}`);
    const rule = parsedRule.data;
    const entries = this.entries();
    const [issue] = this.graphs.check(rule, entries);
    if (issue) throw new BadRequestError(this.graphs.message(issue));
    const context = await this.access.authorize(
      projectId,
      user,
      "automation:read",
      subject,
    );
    const names = this.names(rule);
    if (names.size > 64)
      throw new BadRequestError(
        "A rule may reference at most 64 variables and context names",
      );
    const reserved = this.reservedNames();
    const keys = [...names].filter((name) => !reserved.has(name));
    const rows = keys.length
      ? await this.persistence.variables.findMany({
          where: { projectId, key: { inArray: keys } },
          limit: 64,
        })
      : [];
    const variables = new Map(
      (
        await Promise.all(
          rows.map((row) =>
            this.variable(context, overrides.get(row.key) ?? row),
          ),
        )
      ).map((row) => [row.key, row]),
    );
    const addressable = new Map(
      (await this.channels.all(projectId)).map((entry) => [
        entry.key,
        entry.addressable,
      ]),
    );
    for (const node of rule.nodes) {
      // A node whose dependency is gone breaks its source (#Q3806): the
      // per-source health reports it, it is not the author's refusal.
      if (options.skip?.has(node.id)) continue;
      const path = node.id;
      if (node.kind === "source") {
        if (node.type === AutomationVocabulary.SCHEDULE) {
          const resolvedCron = await this.value(
            projectId,
            { kind: "text", required: true, max: 128 },
            node.config.cron,
            {},
            variables,
            `${path}.cron`,
            false,
            targets,
          );
          if (resolvedCron.complete) {
            try {
              scheduleCron = this.cron.validate(resolvedCron.value as string);
            } catch (error) {
              throw new BadRequestError(
                error instanceof Error ? error.message : "Invalid UTC cron",
              );
            }
          }
          continue;
        }
        const source = this.require(context, node.type, "event", path);
        await this.slots(
          projectId,
          source,
          node.config,
          {},
          variables,
          path,
          false,
          targets,
        );
        continue;
      }
      if (node.kind === "read") {
        const source = this.require(context, node.type, undefined, path);
        if (source.type !== "selection" && source.type !== "metric")
          throw new BadRequestError(
            `${path}: '${node.type}' is not a registered selection or scalar metric`,
          );
        const resolved = await this.slots(
          projectId,
          source,
          node.config.filters as Record<string, unknown>,
          {},
          variables,
          `${path}.filters`,
          false,
          targets,
        );
        if (source.type === "metric" && resolved.complete) {
          const schema = this.metrics.get(source.key).filters;
          if (schema.type !== "object")
            throw new BadRequestError(
              `Metric '${source.key}' has no object filter contract`,
            );
          this.parseFilters(schema as ZObject, resolved.values);
        }
        continue;
      }
      const fields = this.graphs.names(rule, node.id, entries);
      if (node.kind === "condition") {
        const guard = node.config as AutomationGuard;
        await this.value(
          projectId,
          {
            kind: fields[guard.field],
            required: true,
            ...(guard.operator === "delta" ? { min: 0 } : {}),
          },
          guard.value,
          fields,
          variables,
          `${path}.value`,
          false,
          targets,
        );
        continue;
      }
      const sources = this.graphs
        .reachingSources(rule, node.id)
        .map((id) => this.graphs.sourceKey(rule, id))
        .map((key) => entries.find((entry) => entry.key === key)!);
      const descriptor = this.require(context, node.type, "action", path);
      // Validated one channel at a time (#Q3613): the vocabulary's notify
      // takes one `channel`, and a run takes one step per channel.
      const config = node.config as { channel?: string; channels?: string[] };
      const steps: Array<{ node: string; channel?: string }> =
        node.type !== "notify"
          ? [{ node: node.id }]
          : (config.channels ?? (config.channel ? [config.channel] : [])).map(
              (channel) => ({ node: node.id, channel }),
            );
      for (const step of steps) {
        const action = this.graphs.action(rule, step);
        const label = step.channel ? `${path}[${step.channel}]` : path;
        if (
          action.kind === "notify" &&
          !action.recipient &&
          !action.audience &&
          addressable.get(String(action.channel)) !== false
        )
          throw new BadRequestError(
            `${label}.recipient: an addressable channel needs a member`,
          );
        const { kind: _kind, ...values } = action;
        const resolved = await this.slots(
          projectId,
          descriptor,
          values,
          fields,
          variables,
          label,
          false,
          targets,
        );
        if (
          targets &&
          action.kind === "notify" &&
          typeof resolved.values.recipient === "string"
        )
          for (const source of sources) {
            const reason = await this.coreReferences.recipientReason(
              projectId,
              resolved.values.recipient,
              source,
            );
            if (reason)
              throw new BadRequestError(`${label}.recipient: ${reason}`);
          }
      }
    }
    return { rule, scheduleCron };
  }

  public async sourceAvailability(
    projectId: number,
    user: UserAccountToken,
    rule: AutomationGraphValue,
  ): Promise<string | undefined> {
    const context = await this.access.authorize(
      projectId,
      user,
      "automation:read",
    );
    return this.sourceAvailabilityIn(context, rule);
  }

  /**
   * {@link AutomationCatalog.sourceAvailability} under a context the caller
   * already authorized for `automation:read` in the rule's project, so a
   * page of rules or runs authorizes once rather than once per row.
   */
  public sourceAvailabilityIn(
    context: AutomationCatalogContext,
    rule: AutomationGraphValue,
  ): string | undefined {
    // Unavailable only when every source is (#Q3806): one source losing
    // its capability breaks that source, and its health says so on the
    // page, while the others stay readable. A run's subgraph has one source
    // (#Q3804), so a run is redacted as soon as its own source is.
    let first: string | undefined;
    for (const source of this.graphs.sources(rule)) {
      const key = this.graphs.sourceKey(rule, source.id);
      const entry = this.entries().find((item) => item.key === key);
      const reason = entry
        ? this.unavailable(context, entry)
        : "Source vocabulary is unavailable";
      if (!reason) return undefined;
      first ??= reason;
    }
    return first;
  }

  /**
   * Resolved values are data, never template input. This gate validates actual
   * destinations and domain IDs immediately before an adapter is invoked.
   */
  public async validateEffect(
    rule: AutomationGraphValue,
    projectId: number,
    user: UserAccountToken,
    action: AutomationAction,
    subject?: AutomationAccessSubject,
    sourceNode?: string,
    /**
     * Whether to check the effect's targets (a quest, a folio, a release,
     * the recipient). The author's grant and the action's availability are
     * checked either way: losing those is losing authority, while a target
     * that vanished refuses one step (#Q3804).
     */
    targets = true,
  ) {
    const graph = rule;
    const origin = this.graphs.source(graph, sourceNode);
    const context = await this.access.authorize(
      projectId,
      user,
      "automation:write",
      subject,
    );
    const source = this.require(
      context,
      this.graphs.sourceKey(graph, origin.id),
      undefined,
      "source",
    );
    const descriptor = this.require(
      context,
      action.kind,
      "action",
      "effect.kind",
    );
    if (
      action.kind === "notify" &&
      action.audience &&
      (origin.type !== "release.published" || action.category !== "releases")
    )
      throw new BadRequestError(
        "Project audience requires release.published and the releases category",
      );
    const { kind, ...values } = action;
    const resolved = await this.slots(
      projectId,
      descriptor,
      values,
      {},
      new Map(),
      "effect",
      true,
      targets,
    );
    if (
      targets &&
      kind === "notify" &&
      action.kind === "notify" &&
      !action.audience &&
      // A room is nobody's (#Q3613): no recipient to check.
      action.recipient !== undefined
    ) {
      const reason = await this.coreReferences.recipientReason(
        projectId,
        resolved.values.recipient as string,
        source,
      );
      if (reason) throw new BadRequestError(`effect.recipient: ${reason}`);
    }
  }

  /**
   * Reuse the dashboard's resolver, scoped to exactly this project. Progress
   * objects and metrics without an explicit scalar opt-in never reach it.
   */
  public async resolveMetric(
    projectId: number,
    user: UserAccountToken,
    key: string,
    filters: Record<string, unknown>,
    evaluatedAt?: string,
  ) {
    const context = await this.access.authorize(
      projectId,
      user,
      "automation:read",
    );
    this.require(context, key, "metric", "select.key");
    const schema = this.metrics.get(key).filters;
    if (schema.type !== "object")
      throw new BadRequestError("Metric filters must be an object");
    const parsed = this.parseFilters(schema as ZObject, filters);
    const [value] = await this.resolver.resolveForProject(
      [
        {
          id: -1,
          metric: key,
          scope: { kind: "projects", projectIds: [projectId] },
          filters: parsed,
          size: 1,
          position: 0,
        },
      ],
      { ...user, ownership: true },
      context.project,
      undefined,
      undefined,
      evaluatedAt,
    );
    const fields: Record<string, string | number> = {};
    for (const [name, kind] of Object.entries(
      this.metrics.get(key).automation?.fields ?? {},
    )) {
      const field = value?.detail[name];
      if (
        (kind === "number" &&
          typeof field === "number" &&
          Number.isFinite(field)) ||
        (kind === "text" && typeof field === "string")
      )
        fields[name] = field;
    }
    return value?.ok &&
      typeof value.value === "number" &&
      Number.isFinite(value.value)
      ? { status: "value" as const, value: value.value, fields }
      : { status: "no_data" as const, fields };
  }

  protected parseFilters(
    schema: ZObject,
    values: Record<string, unknown>,
  ): Record<string, unknown> {
    const parsed = schema.strict().safeParse(values);
    if (!parsed.success)
      throw new BadRequestError(`select.filters: ${parsed.error.message}`);
    return parsed.data;
  }

  public reservedNames(): Set<string> {
    return new Set([
      ...AutomationVocabulary.RESERVED_KEYS,
      ...this.entries().flatMap((entry) => [
        ...Object.keys(entry.fields),
        ...Object.keys(entry.outputs ?? {}),
      ]),
    ]);
  }

  protected unavailable(
    context: AutomationCatalogContext,
    descriptor: AutomationDescriptor,
  ): string | undefined {
    const permission = descriptor.permissions.find(
      (value) => !context.permissions.includes(value),
    );
    if (permission) return `Missing ${permission}`;
    for (const need of descriptor.needs) {
      if (!context.capabilities[need.capability])
        return `Missing ${need.capability} capability`;
      if (
        need.option &&
        context.capabilities[need.capability]?.[need.option] !== true
      )
        return `Missing ${need.capability}.${need.option} option`;
    }
    return undefined;
  }

  protected require(
    context: AutomationCatalogContext,
    key: string,
    type: AutomationDescriptor["type"] | undefined,
    path: string,
  ): AutomationDescriptor {
    const entry = this.entries().find(
      (item) => item.key === key && (!type || item.type === type),
    );
    if (!entry)
      throw new BadRequestError(
        `${path}: unknown or unsupported automation entry '${key}'`,
      );
    const reason = this.unavailable(context, entry);
    if (reason) throw new BadRequestError(`${path} '${key}': ${reason}`);
    return entry;
  }

  public async inspectVariable(
    projectId: number,
    user: UserAccountToken,
    row: AutomationVariable,
  ) {
    const context = await this.access.authorize(
      projectId,
      user,
      "automation:read",
    );
    return this.variable(context, row);
  }

  /**
   * {@link AutomationCatalog.inspectVariable} under a context the caller
   * already authorized for `automation:read` in the variable's project.
   */
  public inspectVariableIn(
    context: AutomationCatalogContext,
    row: AutomationVariable,
  ) {
    return this.variable(context, row);
  }

  protected async variable(
    context: AutomationCatalogContext,
    row: AutomationVariable,
  ) {
    const { kind, value } = row.value;
    const permission =
      kind === "release"
        ? "release:read"
        : kind === "folio"
          ? "folio:read"
          : kind === "member"
            ? "member:read"
            : undefined;
    const needs: AutomationDescriptor["needs"] =
      kind === "release"
        ? [{ capability: "plan", option: "releases" }]
        : kind === "folio"
          ? [{ capability: "remember" }]
          : [];
    let reason = this.reservedNames().has(row.key)
      ? `Variable '${row.key}' uses a reserved context name`
      : this.unavailable(context, {
          key: row.key,
          type: "selection",
          result: "scalar",
          fields: {},
          slots: {},
          operators: [],
          permissions: permission ? [permission] : [],
          needs,
        });
    if (!reason && ["release", "folio", "member", "channel"].includes(kind))
      reason = await this.references.reason(kind, context.project.id, value);
    return {
      id: row.id,
      key: row.key,
      version: row.version,
      kind,
      available: !reason,
      ...(reason ? { reason } : { value: row.value }),
    };
  }

  public names(rule: unknown): Set<string> {
    const names = new Set<string>();
    const visit = (value: unknown): void => {
      if (typeof value === "string")
        for (const name of this.tokens.names(value)) names.add(name);
      else if (Array.isArray(value)) for (const item of value) visit(item);
      else if (value && typeof value === "object")
        for (const item of Object.values(value)) visit(item);
    };
    visit(rule);
    return names;
  }

  protected async slots(
    projectId: number,
    entry: AutomationDescriptor,
    values: Record<string, unknown>,
    fields: Record<string, AutomationSlotKind>,
    variables: AutomationVariableMap,
    path: string,
    literal = false,
    targets = true,
  ) {
    for (const key of Object.keys(values))
      if (!Object.hasOwn(entry.slots, key))
        throw new BadRequestError(`${path}.${key}: unknown slot`);
    let complete = true;
    const resolved: Record<string, unknown> = {};
    for (const [key, slot] of Object.entries(entry.slots)) {
      const input = values[key] ?? slot.default;
      if (input === undefined) {
        if (slot.required)
          throw new BadRequestError(`${path}.${key}: required`);
        continue;
      }
      const value = await this.value(
        projectId,
        slot,
        input,
        fields,
        variables,
        `${path}.${key}`,
        literal,
        targets,
      );
      complete &&= value.complete;
      if (value.complete) resolved[key] = value.value;
    }
    return { complete, values: resolved };
  }

  protected async value(
    projectId: number,
    slot: AutomationSlot,
    input: unknown,
    fields: Record<string, AutomationSlotKind>,
    variables: AutomationVariableMap,
    path: string,
    literal = false,
    targets = true,
  ): Promise<{ complete: boolean; value?: unknown }> {
    let bound: { complete: boolean; value?: unknown };
    try {
      bound = this.bindings.resolve({
        slot,
        value: input,
        fields,
        variables,
        path,
        literal,
      });
    } catch (error) {
      throw new BadRequestError(
        error instanceof Error ? error.message : "Invalid template binding",
      );
    }
    if (!bound.complete) return bound;
    const value = bound.value;
    const kind = slot.kind;
    const resource =
      slot.resource ??
      (["release", "folio", "member", "channel"].includes(kind)
        ? kind
        : undefined);
    if (resource && targets) {
      const reason = await this.references.reason(
        resource,
        projectId,
        value as string | number,
      );
      if (reason) throw new BadRequestError(`${path}: ${reason}`);
    }
    return { complete: true, value };
  }
}

export type AutomationCatalogContext = Awaited<
  ReturnType<AutomationAccess["authorize"]>
>;
type AutomationVariableMap = Map<
  string,
  {
    key: string;
    version: number;
    kind: AutomationVariable["value"]["kind"];
    available: boolean;
    reason?: string;
    value?: AutomationVariable["value"];
  }
>;
