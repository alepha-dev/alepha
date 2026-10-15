import { $inject, type ZObject, z } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError } from "alepha/server";

import type { AutomationVariable } from "../entities/automationVariables.ts";
import { automationCatalogSchema } from "../schemas/automationCatalogSchema.ts";
import type { AutomationDescriptor } from "../schemas/automationDescriptorSchema.ts";
import {
  automationRuleSchema,
  type AutomationRule,
} from "../schemas/automationRuleSchema.ts";
import type { AutomationSlotKind } from "../schemas/automationSlotKindSchema.ts";
import type { AutomationSlot } from "../schemas/automationSlotSchema.ts";
import { AutomationTemplateTokens } from "../schemas/AutomationTemplateTokens.ts";
import { AutomationVocabulary } from "../schemas/AutomationVocabulary.ts";
import { DashboardMetricCatalog } from "../schemas/DashboardMetricCatalog.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationChannels } from "./AutomationChannels.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationReferences } from "./AutomationReferences.ts";
import { CoreAutomationReferences } from "./CoreAutomationReferences.ts";
import { DashboardMetricRegistry } from "./DashboardMetricRegistry.ts";

/**
 * Authoring and execution use the same typed vocabulary and legality checks.
 * Feature-owned reference validators prove same-project identity, rather than
 * treating a resource description or an unfiltered ID lookup as authorization.
 */
export class AutomationCatalog {
  protected readonly access = $inject(AutomationAccess);
  protected readonly vocabulary = $inject(AutomationVocabulary);
  protected readonly metrics = $inject(DashboardMetricCatalog);
  protected readonly resolver = $inject(DashboardMetricRegistry);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly channels = $inject(AutomationChannels);
  protected readonly references = $inject(AutomationReferences);
  protected readonly coreReferences = $inject(CoreAutomationReferences);
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
    projectId: number,
    user: UserAccountToken,
    input: AutomationRule,
    overrides: Map<string, AutomationVariable> = new Map(),
  ): Promise<AutomationRule> {
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
      await this.value(
        projectId,
        { kind: "text", required: true, max: 128 },
        rule.trigger.cron,
        {},
        variables,
        "trigger.cron",
      );
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
      await this.value(
        projectId,
        { kind, required: true },
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
    return rule;
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
    );
    return value?.ok &&
      typeof value.value === "number" &&
      Number.isFinite(value.value)
      ? { status: "value" as const, value: value.value }
      : { status: "no_data" as const };
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
  ): Promise<{ complete: boolean; value?: unknown }> {
    if (slot.kind === "textArray" && Array.isArray(input)) {
      if (input.length > 50)
        throw new BadRequestError(`${path}: at most 50 values`);
      const items = await Promise.all(
        input.map((item, index) =>
          this.value(
            projectId,
            { ...slot, kind: "text", min: undefined, max: undefined },
            item,
            fields,
            variables,
            `${path}[${index}]`,
          ),
        ),
      );
      return items.every((item) => item.complete)
        ? { complete: true, value: items.map((item) => item.value) }
        : { complete: false };
    }
    let value = input;
    if (typeof input === "string") {
      const names = this.tokens.names(input);
      const whole = this.tokens.whole(input);
      if (names.length && slot.bindable === false)
        throw new BadRequestError(`${path}: use a literal choice`);
      for (const name of names) {
        const variable = variables.get(name);
        if (!Object.hasOwn(fields, name) && !variable)
          throw new BadRequestError(`${path}: unknown placeholder '${name}'`);
        if (variable && !variable.available)
          throw new BadRequestError(
            `${path}: variable '${name}' is unavailable: ${variable.reason}`,
          );
      }
      if (whole) {
        const variable = variables.get(whole);
        const contextKind = Object.hasOwn(fields, whole)
          ? fields[whole]
          : undefined;
        const kind = contextKind ?? variable?.kind;
        if (kind !== slot.kind && !(slot.kind === "text" && slot.template))
          throw new BadRequestError(
            `${path}: placeholder '${whole}' has type '${kind}', expected '${slot.kind}'`,
          );
        if (contextKind) return { complete: false };
        value =
          slot.kind === "text" && slot.template
            ? String(variable!.value!.value)
            : variable!.value!.value;
      } else if (names.length) {
        if (slot.kind !== "text")
          throw new BadRequestError(
            `${path}: mixed interpolation yields text, expected '${slot.kind}'`,
          );
        return { complete: false };
      }
    }
    const kind = slot.kind;
    const valid =
      kind === "number"
        ? typeof value === "number" && Number.isFinite(value)
        : kind === "release"
          ? typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value > 0
          : kind === "boolean"
            ? typeof value === "boolean"
            : kind === "textArray"
              ? Array.isArray(value) &&
                value.length <= 50 &&
                value.every((item) => typeof item === "string")
              : kind === "member" || kind === "folio"
                ? z.uuid().safeParse(value).success
                : typeof value === "string";
    if (!valid) throw new BadRequestError(`${path}: expected '${kind}'`);
    if (
      slot.values &&
      !(Array.isArray(value) ? value : [value]).every((item) =>
        slot.values!.includes(item as never),
      )
    )
      throw new BadRequestError(`${path}: unsupported value`);
    const size =
      typeof value === "string" || Array.isArray(value)
        ? value.length
        : typeof value === "number"
          ? value
          : undefined;
    if (
      size !== undefined &&
      ((slot.min !== undefined && size < slot.min) ||
        (slot.max !== undefined && size > slot.max))
    )
      throw new BadRequestError(`${path}: outside the allowed bounds`);
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

type AutomationCatalogContext = Awaited<
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
