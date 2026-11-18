import type { AutomationAction } from "./automationActionSchema.ts";
import type { AutomationFilterValue } from "./automationFilterValueSchema.ts";
import type { AutomationGraphEdge } from "./automationGraphEdgeSchema.ts";
import type { AutomationGraphNode } from "./automationGraphNodeSchema.ts";
import type { AutomationGraphValue } from "./automationGraphSchema.ts";
import type { AutomationGuard } from "./automationGuardSchema.ts";
import { AutomationVocabulary } from "./AutomationVocabulary.ts";

/**
 * The small builder presets are written with (#Q3805), browser-safe: a
 * straight line from one source, through an optional read and condition,
 * to its actions, each wired to the next. Node ids are fixed: `source`, `read`,
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
    return { version: 2, nodes, edges };
  }

  /**
   * "When X or Y, do Z" in one call (#Q3809): every source wired to every
   * action. Ids are the given ones, or the type with its dots
   * for a source (`host.offline`) and `action-N` for an action. It invents
   * no per-source copy: an action naming a field one source lacks is the
   * validator's refusal.
   */
  public compact(input: AutomationCompact): AutomationGraphValue {
    const taken = new Set<string>();
    const unique = (id: string) => {
      let candidate = id;
      for (let index = 2; taken.has(candidate); index++)
        candidate = `${id}-${index}`;
      taken.add(candidate);
      return candidate;
    };
    const sources = input.sources.map((source): AutomationGraphNode => ({
      id: unique(source.id ?? source.type.toLowerCase()),
      kind: "source",
      type: source.type,
      config: source.config ?? {},
    }));
    const actions = input.actions.map((action, index): AutomationGraphNode => ({
      id: unique(action.id ?? `action-${index + 1}`),
      kind: "action",
      type: action.type,
      config: action.config,
    }));
    return {
      version: 2,
      nodes: [...sources, ...actions],
      edges: sources.flatMap((source) =>
        actions.map((action) => ({
          from: source.id,
          port: "out" as const,
          to: action.id,
        })),
      ),
    };
  }
}

/**
 * The compact form an agent or a command line writes (#Q3809): sources and
 * actions, every source wired to every action.
 */
export interface AutomationCompact {
  sources: Array<{
    type: string;
    config?: Record<string, unknown>;
    id?: string;
  }>;
  actions: Array<{
    type: string;
    config: Record<string, unknown>;
    id?: string;
  }>;
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
