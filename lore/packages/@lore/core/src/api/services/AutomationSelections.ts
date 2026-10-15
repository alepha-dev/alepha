import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import type { SQLLike } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ForbiddenError } from "alepha/server";

import type { Automation } from "../entities/automations.ts";
import type { AutomationRunSnapshot } from "../schemas/automationRunSnapshotSchema.ts";
import {
  automationSelectionCursorSchema,
  type AutomationSelectionCursor,
} from "../schemas/automationSelectionCursorSchema.ts";
import { AutomationTemplateBindings } from "../schemas/AutomationTemplateBindings.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import {
  AutomationContextBuilder,
  type AutomationRenderContext,
} from "./AutomationContextBuilder.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";

/**
 * Named server adapters only. Every database filter is resolved and validated
 * before a handler sees it; private source fields never leave the builder.
 */
export class AutomationSelections {
  protected readonly handlers = new Map<string, AutomationSelectionHandler>();
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly builder = $inject(AutomationContextBuilder);
  protected readonly bindings = $inject(AutomationTemplateBindings);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly time = $inject(DateTimeProvider);
  public register(key: string, handler: AutomationSelectionHandler): void {
    if (this.handlers.has(key))
      throw new AlephaError(`Duplicate automation selector '${key}'`);
    this.handlers.set(key, handler);
  }
  public async evaluate(input: {
    rule: Automation;
    user: UserAccountToken;
    variables: AutomationRunSnapshot["variables"];
    evaluatedAt?: string;
    cursor?: AutomationSelectionCursor;
  }): Promise<AutomationSelected> {
    return this.database.primary(async () => {
      if (input.user.id !== input.rule.authorUserId)
        throw new ForbiddenError("Selection requires the immutable author");
      await this.catalog.validate(
        input.rule.projectId,
        input.user,
        input.rule.rule,
      );
      const selection = input.rule.rule.select;
      if (input.cursor && selection?.kind !== "rows")
        throw new BadRequestError(
          "Only row selectors accept continuation cursors",
        );
      if (!selection)
        throw new BadRequestError("Event rules have no scheduled selection");
      const descriptor = this.catalog
        .entries()
        .find((entry) => entry.key === selection.key);
      if (!descriptor || descriptor.result !== selection.kind)
        throw new BadRequestError("Selection vocabulary changed");
      const variables = new Map(
        input.variables.map((variable) => [
          variable.key,
          { kind: variable.value.kind, available: true, value: variable.value },
        ]),
      );
      const filters: Record<string, unknown> = {};
      for (const [key, slot] of Object.entries(descriptor.slots)) {
        const value = selection.filters[key] ?? slot.default;
        if (value === undefined && !slot.required) continue;
        try {
          filters[key] = this.bindings.resolve({
            slot,
            value,
            fields: {},
            variables,
            path: `select.filters.${key}`,
          }).value;
        } catch (error) {
          throw new BadRequestError(
            error instanceof Error ? error.message : "Invalid selector binding",
          );
        }
      }
      const evaluatedAt = input.evaluatedAt ?? this.time.nowISOString();
      if (!Number.isFinite(new Date(evaluatedAt).getTime()))
        throw new BadRequestError("Invalid selection time");
      if (descriptor.type === "metric") {
        const value = await this.catalog.resolveMetric(
          input.rule.projectId,
          input.user,
          selection.key,
          filters,
        );
        const context = await this.builder.source(
          input.rule.projectId,
          selection.key,
          { value: value.status === "value" ? value.value : null },
        );
        return {
          kind: "scalar",
          contexts: [context],
          items: [context.values],
          total: 1,
          totalIsExact: true,
          hasMore: false,
          truncated: false,
          noData: value.status === "no_data",
          evaluatedAt,
        };
      }
      const handler = this.handlers.get(selection.key);
      if (!handler)
        throw new BadRequestError(`No registered selector '${selection.key}'`);
      const page = await handler.select({
        projectId: input.rule.projectId,
        filters,
        evaluatedAt,
        ...(input.cursor
          ? { cursor: automationSelectionCursorSchema.parse(input.cursor) }
          : {}),
      });
      if (
        page.items.length > 50 ||
        !Number.isSafeInteger(page.total) ||
        page.total < page.items.length ||
        (page.hasMore && page.total <= page.items.length)
      )
        throw new BadRequestError(
          "Selector violated its bounded count contract",
        );
      const contexts =
        selection.kind === "collection"
          ? [
              await this.builder.collection(
                input.rule.projectId,
                selection.key,
                page,
                filters,
              ),
            ]
          : await this.builder.rows(
              input.rule.projectId,
              selection.key,
              page.items,
            );
      const items =
        selection.kind === "collection"
          ? contexts[0].collection!.items
          : contexts.map((context) => context.values);
      return {
        kind: selection.kind,
        contexts,
        items,
        total: page.total,
        totalIsExact: page.totalIsExact,
        hasMore: page.hasMore,
        truncated:
          page.hasMore ||
          contexts.some((context) => context.collection?.truncated),
        noData: false,
        evaluatedAt,
        ...(page.next
          ? { next: automationSelectionCursorSchema.parse(page.next) }
          : {}),
      };
    });
  }
  public settlement(
    key: string,
    projectId: number,
    context: AutomationRenderContext,
    at: string,
  ) {
    return this.handlers.get(key)?.settle?.(context.values, at, projectId);
  }
}
export interface AutomationSelectionHandler {
  select(input: {
    projectId: number;
    filters: Record<string, unknown>;
    evaluatedAt: string;
    cursor?: AutomationSelectionCursor;
  }): Promise<AutomationSelectionPage>;
  settle?(
    values: AutomationRunSnapshot["inputs"],
    at: string,
    projectId: number,
  ): { condition: SQLLike; statements: SQLLike[]; changedTables: string[] };
}
export interface AutomationSelectionPage {
  items: Record<string, unknown>[];
  total: number;
  totalIsExact: boolean;
  hasMore: boolean;
  next?: AutomationSelectionCursor;
}
export interface AutomationSelected {
  kind: "rows" | "scalar" | "collection";
  contexts: AutomationRenderContext[];
  items: AutomationRunSnapshot["inputs"][];
  total: number;
  totalIsExact: boolean;
  hasMore: boolean;
  truncated: boolean;
  noData: boolean;
  evaluatedAt: string;
  next?: AutomationSelectionCursor;
}
