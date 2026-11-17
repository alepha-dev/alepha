import type { AutomationAction } from "./automationActionSchema.ts";
import type { AutomationFilterValue } from "./automationFilterValueSchema.ts";
import { AutomationGraph } from "./AutomationGraph.ts";
import type { AutomationGraphEdge } from "./automationGraphEdgeSchema.ts";
import type { AutomationGraphNode } from "./automationGraphNodeSchema.ts";
import type { AutomationGraphValue } from "./automationGraphSchema.ts";
import type { AutomationGuard } from "./automationGuardSchema.ts";
import { AutomationVocabulary } from "./AutomationVocabulary.ts";

/**
 * The small builder presets are written with (#Q3805), browser-safe: a
 * straight line from one source, through an optional read and condition,
 * to its actions, each wired to the next, laid out by
 * {@link AutomationGraph.layout}. Node ids are fixed: `source`, `read`,
 * `condition`, `action-1` ...
 */
export class AutomationGraphBuilder {
  public line(input: AutomationLine): AutomationGraphValue {
    const nodes: AutomationGraphNode[] = [];
    const edges: AutomationGraphEdge[] = [];
    const schedule = input.source === AutomationVocabulary.SCHEDULE;
    nodes.push({
      id: "source",
      kind: "source",
      type: input.source,
      config: schedule
        ? { cron: input.cron ?? "" }
        : Object.fromEntries(
            Object.entries(input.filters ?? {}).filter(
              ([, value]) => value !== undefined,
            ),
          ),
    });
    let last = { id: "source", port: "out" as AutomationGraphEdge["port"] };
    const wire = (id: string, port: AutomationGraphEdge["port"] = "out") => {
      edges.push({ from: last.id, port: last.port, to: id });
      last = { id, port };
    };
    if (input.read) {
      nodes.push({
        id: "read",
        kind: "read",
        type: input.read.key,
        config: { filters: input.read.filters ?? {} },
      });
      wire("read");
    }
    if (input.condition) {
      nodes.push({
        id: "condition",
        kind: "condition",
        type: AutomationVocabulary.COMPARE,
        config: { ...input.condition },
      });
      wire("condition", "true");
    }
    for (const [index, action] of input.actions.entries()) {
      const { kind, ...config } = action;
      const id = `action-${index + 1}`;
      nodes.push({ id, kind: "action", type: kind, config });
      wire(id);
    }
    return AutomationGraph.layout({ version: 2, nodes, edges });
  }
}

/**
 * A one-source automation, as a preset writes it.
 */
export interface AutomationLine {
  /**
   * An event key, or `schedule`.
   */
  source: string;
  /**
   * An event's filters (`app`, `monitor`, `host`).
   */
  filters?: Record<string, string | undefined>;
  /**
   * A schedule's UTC cron.
   */
  cron?: string;
  read?: { key: string; filters?: Record<string, AutomationFilterValue> };
  condition?: AutomationGuard;
  actions: AutomationAction[];
}
