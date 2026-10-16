import { $inject, type ZObject } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError } from "alepha/server";

import type { AutomationVariable } from "../entities/automationVariables.ts";
import { automationCatalogSchema } from "../schemas/automationCatalogSchema.ts";
import { AutomationCron } from "../schemas/AutomationCron.ts";
import type { AutomationDescriptor } from "../schemas/automationDescriptorSchema.ts";
import {
  automationRuleSchema,
  type AutomationRule,
} from "../schemas/automationRuleSchema.ts";
import type { AutomationSlotKind } from "../schemas/automationSlotKindSchema.ts";
import type { AutomationSlot } from "../schemas/automationSlotSchema.ts";
import { AutomationTemplateBindings } from "../schemas/AutomationTemplateBindings.ts";
import { AutomationTemplateTokens } from "../schemas/AutomationTemplateTokens.ts";
import { AutomationVocabulary } from "../schemas/AutomationVocabulary.ts";
import { DashboardMetricCatalog } from "../schemas/DashboardMetricCatalog.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
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
      presets: this.presets.all().map((preset) => {
        const reason = this.unavailable(context, {
          ...preset,
          type: "selection",
          result: "scalar",
          operators: [],
        });
        return { ...preset, available: !reason, ...(reason ? { reason } : {}) };
      }),
      variables,
      variablesHasMore: rows.length > 100,
      channels: await this.channels.all(projectId),
      limits: {
        selectedRows: 50,
        actions: 5,
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
  ): Promise<AutomationRule> {
    return (await this.compile(...args)).rule;
  }
  public async compile(
    projectId: number,
    user: UserAccountToken,
    input: AutomationRule,
    overrides: Map<string, AutomationVariable> = new Map(),
  ) {
    let scheduleCron: string | undefined;
    const parsedRule = automationRuleSchema.safeParse(input);
    if (!parsedRule.success)
      throw new BadRequestError(`rule: ${parsedRule.error.message}`);
    const rule = parsedRule.data;
    const context = await this.access.authorize(
      projectId,
      user,
      "automation:read",
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
    let source: AutomationDescriptor;
    if (rule.trigger.kind === "event") {
      source = this.require(
        context,
        rule.trigger.event,
        "event",
        "trigger.event",
      );
      const values =
        "app" in rule.trigger && rule.trigger.app !== undefined
          ? { app: rule.trigger.app }
          : {};
      await this.slots(projectId, source, values, {}, variables, "trigger");
    } else {
      const resolvedCron = await this.value(
        projectId,
        { kind: "text", required: true, max: 128 },
        rule.trigger.cron,
        {},
        variables,
        "trigger.cron",
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
      source = this.require(context, rule.select!.key, undefined, "select.key");
      if (source.type !== "selection" && source.type !== "metric")
        throw new BadRequestError(
          "select.key must name a registered selection or scalar metric",
        );
      if (source.result !== rule.select!.kind)
        throw new BadRequestError(
          `select.kind must be '${source.result}' for '${source.key}'`,
        );
      const resolved = await this.slots(
        projectId,
        source,
        rule.select!.filters,
        {},
        variables,
        "select.filters",
      );
      if (source.type === "metric" && resolved.complete) {
        const schema = this.metrics.get(source.key).filters;
        if (schema.type !== "object")
          throw new BadRequestError(
            `Metric '${source.key}' has no object filter contract`,
          );
        this.parseFilters(schema as ZObject, resolved.values);
      }
    }
    if (rule.guard) {
      const kind = Object.hasOwn(source.fields, rule.guard.field)
        ? source.fields[rule.guard.field]
        : undefined;
      if (!kind)
        throw new BadRequestError(
          `guard.field '${rule.guard.field}' is not exposed by '${source.key}'`,
        );
      if (
        kind !== "number" &&
        rule.guard.operator !== "eq" &&
        rule.guard.operator !== "ne"
      )
        throw new BadRequestError(
          `guard.operator '${rule.guard.operator}' requires a numeric field`,
        );
      if (
        ["delta", "crossesAbove"].includes(rule.guard.operator) &&
        (rule.trigger.kind !== "schedule" ||
          source.result !== "scalar" ||
          !source.operators.includes(rule.guard.operator))
      )
        throw new BadRequestError(
          `guard.operator '${rule.guard.operator}' is not supported by this scalar selection`,
        );
      if (rule.guard.operator === "delta" && rule.guard.field !== "value")
        throw new BadRequestError(
          "Delta compares the scalar value with its previous closed day",
        );
      await this.value(
        projectId,
        {
          kind,
          required: true,
          ...(rule.guard.operator === "delta" ? { min: 0 } : {}),
        },
        rule.guard.value,
        source.fields,
        variables,
        "guard.value",
      );
    }
    for (const [index, action] of rule.actions.entries()) {
      const descriptor = this.require(
        context,
        action.kind,
        "action",
        `actions[${index}].kind`,
      );
      const { kind, ...values } = action;
      const resolved = await this.slots(
        projectId,
        descriptor,
        values,
        source.fields,
        variables,
        `actions[${index}]`,
      );
      if (kind === "notify") {
        if (
          action.audience &&
          (rule.trigger.kind !== "event" ||
            rule.trigger.event !== "release.published" ||
            action.category !== "releases")
        )
          throw new BadRequestError(
            "Project audience requires release.published and the releases category",
          );
        if (typeof resolved.values.recipient === "string") {
          const reason = await this.coreReferences.recipientReason(
            projectId,
            resolved.values.recipient,
            source,
          );
          if (reason)
            throw new BadRequestError(`actions[${index}].recipient: ${reason}`);
        }
        if (
          action.category === "releases" &&
          (rule.trigger.kind !== "event" ||
            rule.trigger.event !== "release.published")
        )
          throw new BadRequestError(
            "actions: the releases category requires release.published",
          );
        if (
          action.category === "reminders" &&
          rule.select?.key !== "quests.remindersDue"
        )
          throw new BadRequestError(
            "actions: the reminders category requires quests.remindersDue",
          );
      }
    }
    return { rule, scheduleCron };
  }

  public async sourceAvailability(
    projectId: number,
    user: UserAccountToken,
    rule: AutomationRule,
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
    rule: AutomationRule,
  ): string | undefined {
    const key =
      rule.trigger.kind === "event" ? rule.trigger.event : rule.select!.key;
    const entry = this.entries().find((item) => item.key === key);
    return entry
      ? this.unavailable(context, entry)
      : "Source vocabulary is unavailable";
  }

  /**
   * Resolved values are data, never template input. This gate validates actual
   * destinations and domain IDs immediately before an adapter is invoked.
   */
  public async validateEffect(
    rule: AutomationRule,
    projectId: number,
    user: UserAccountToken,
    action: AutomationRule["actions"][number],
  ) {
    const context = await this.access.authorize(
      projectId,
      user,
      "automation:write",
    );
    const source = this.require(
      context,
      rule.trigger.kind === "event" ? rule.trigger.event : rule.select!.key,
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
      (rule.trigger.kind !== "event" ||
        rule.trigger.event !== "release.published" ||
        action.category !== "releases")
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
    );
    if (kind === "notify" && !(action.kind === "notify" && action.audience)) {
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
      ...this.entries().flatMap((entry) => Object.keys(entry.fields)),
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
        ? [{ capability: "work", option: "releases" }]
        : kind === "folio"
          ? [{ capability: "knowledge" }]
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

  public names(rule: AutomationRule): Set<string> {
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
    if (resource) {
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
