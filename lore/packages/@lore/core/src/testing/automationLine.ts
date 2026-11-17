import type { AutomationAction } from "../api/schemas/automationActionSchema.ts";
import type { AutomationFilterValue } from "../api/schemas/automationFilterValueSchema.ts";
import { AutomationGraphBuilder } from "../api/schemas/AutomationGraphBuilder.ts";
import type { AutomationGraphValue } from "../api/schemas/automationGraphSchema.ts";
import type { AutomationGuard } from "../api/schemas/automationGuardSchema.ts";

/**
 * A one-source automation as a spec writes it (#Q3805): what starts it,
 * what it reads, the one condition and the actions, each after the last.
 * {@link automationLine} builds the graph with the builder presets use, so
 * node ids are `source`, `read`, `condition`, `action-1` ...
 */
export interface AutomationLineSpec {
  trigger:
    | {
        kind: "event";
        event: string;
        app?: string;
        monitor?: string;
        host?: string;
      }
    | { kind: "schedule"; cron: string };
  select?: {
    kind?: string;
    key: string;
    filters?: Record<string, AutomationFilterValue>;
  } | null;
  guard?: AutomationGuard | null;
  actions: AutomationAction[];
}

/**
 * The graph of an {@link AutomationLineSpec}.
 */
export const automationLine = (
  spec: AutomationLineSpec,
): AutomationGraphValue =>
  new AutomationGraphBuilder().line({
    source: spec.trigger.kind === "event" ? spec.trigger.event : "schedule",
    ...(spec.trigger.kind === "event"
      ? {
          filters: {
            app: spec.trigger.app,
            monitor: spec.trigger.monitor,
            host: spec.trigger.host,
          },
        }
      : { cron: spec.trigger.cron }),
    ...(spec.select
      ? { read: { key: spec.select.key, filters: spec.select.filters ?? {} } }
      : {}),
    ...(spec.guard ? { condition: spec.guard } : {}),
    actions: spec.actions,
  });
