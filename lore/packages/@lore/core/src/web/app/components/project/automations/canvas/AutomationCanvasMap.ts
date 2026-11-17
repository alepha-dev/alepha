import type { Edge, Node } from "@xyflow/react";

import { AutomationGraph } from "../../../../../../api/schemas/AutomationGraph.ts";
import type { AutomationGraphEdge } from "../../../../../../api/schemas/automationGraphEdgeSchema.ts";
import type { AutomationGraphNode } from "../../../../../../api/schemas/automationGraphNodeSchema.ts";
import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import type { AutomationNodeOutcome } from "../../../../../../api/schemas/automationNodeOutcomeSchema.ts";
import type { AutomationResourceSource } from "../../../../../../api/schemas/automationResourceSourceSchema.ts";

export type AutomationCanvasOutcome = AutomationNodeOutcome["outcome"];

export type AutomationCanvasPort = NonNullable<AutomationNodeOutcome["port"]>;

/**
 * What a canvas node carries: the graph node itself, and what the page
 * paints on it.
 */
export interface AutomationCanvasNodeData extends Record<string, unknown> {
  node: AutomationGraphNode;
  /**
   * A source's own switch and health (#Q3806), on an automation's page.
   */
  source?: AutomationResourceSource;
  /**
   * What the node did, on a run's page: the worst of its rows.
   */
  outcome?: AutomationCanvasOutcome;
  /**
   * The ports a condition took, over all of its rows.
   */
  ports?: AutomationCanvasPort[];
  /**
   * Whether the canvas paints a run: a node without an outcome then took
   * no part in it.
   */
  painted: boolean;
  /**
   * The names the page resolved for the ids a node holds.
   */
  names?: AutomationCanvasNames;
}

/**
 * Names by id, for what an action targets: configured channels, members,
 * folios. An id without a name is shown as it is.
 */
export interface AutomationCanvasNames {
  channels: Record<string, string>;
  members: Record<string, string>;
  folios: Record<string, string>;
}

export type AutomationCanvasNode = Node<
  AutomationCanvasNodeData,
  AutomationGraphNode["kind"]
>;

export interface AutomationCanvasEdgeData extends Record<string, unknown> {
  port: AutomationGraphEdge["port"];
  /**
   * On a run's page, whether the run went along this edge.
   */
  walked?: boolean;
}

export type AutomationCanvasEdge = Edge<AutomationCanvasEdgeData>;

export interface AutomationCanvasInput {
  graph: AutomationGraphValue;
  /**
   * The automation's sources as its resource reports them.
   */
  sources?: AutomationResourceSource[];
  /**
   * A run's per-node evidence (#Q3807); absent, nothing is painted.
   */
  outcomes?: AutomationNodeOutcome[];
  selected?: string;
  names?: AutomationCanvasNames;
}

/**
 * A stored graph as React Flow nodes and edges (#Q3810), pure: no React,
 * no i18n, so the mapping has its own spec and the canvas only draws.
 *
 * Positions are the stored ones; a graph saved without them is laid out
 * with `AutomationGraph.layout`, the one layout. A run is painted from its
 * per-node outcomes: a node with several rows shows the worst of them, a
 * condition every port it took, and an edge is walked when the node it
 * leaves ran and, from a condition, the run took its port.
 */
export class AutomationCanvasMap {
  /**
   * Outcomes from the worst: a node's rows fold to the first one present.
   */
  public static readonly SEVERITY: readonly AutomationCanvasOutcome[] = [
    "failed",
    "unknown",
    "refused",
    "pending",
    "ran",
    "skipped",
    "not_reached",
  ];

  public map(input: AutomationCanvasInput): {
    nodes: AutomationCanvasNode[];
    edges: AutomationCanvasEdge[];
  } {
    const graph = input.graph.nodes.every((node) => node.position)
      ? input.graph
      : AutomationGraph.layout(input.graph);
    const painted = input.outcomes !== undefined;
    const outcomes = this.fold(input.outcomes ?? []);
    const sources = new Map(
      (input.sources ?? []).map((source) => [source.node, source]),
    );
    const nodes = graph.nodes.map((node): AutomationCanvasNode => {
      const done = outcomes.get(node.id);
      const source = sources.get(node.id);
      return {
        id: node.id,
        type: node.kind,
        position: node.position ?? { x: 0, y: 0 },
        selected: node.id === input.selected,
        data: {
          node,
          painted,
          ...(input.names ? { names: input.names } : {}),
          ...(source ? { source } : {}),
          ...(done ? { outcome: done.outcome } : {}),
          ...(done?.ports.length ? { ports: done.ports } : {}),
        },
      };
    });
    const edges = graph.edges.map((edge): AutomationCanvasEdge => {
      const from = outcomes.get(edge.from);
      const walked =
        from?.outcome === "ran" &&
        (edge.port === "out" ||
          from.ports.includes(edge.port as AutomationCanvasPort));
      return {
        id: `${edge.from}:${edge.port}:${edge.to}`,
        source: edge.from,
        sourceHandle: edge.port,
        target: edge.to,
        targetHandle: "in",
        data: { port: edge.port, ...(painted ? { walked } : {}) },
      };
    });
    return { nodes, edges };
  }

  /**
   * Each node's rows folded to one outcome, and the ports it took.
   */
  public fold(
    outcomes: AutomationNodeOutcome[],
  ): Map<
    string,
    { outcome: AutomationCanvasOutcome; ports: AutomationCanvasPort[] }
  > {
    const folded = new Map<
      string,
      { outcome: AutomationCanvasOutcome; ports: AutomationCanvasPort[] }
    >();
    const rank = (outcome: AutomationCanvasOutcome) =>
      AutomationCanvasMap.SEVERITY.indexOf(outcome);
    for (const item of outcomes) {
      const current = folded.get(item.node);
      const ports = [
        ...new Set([
          ...(current?.ports ?? []),
          ...(item.port ? [item.port] : []),
        ]),
      ].sort();
      folded.set(item.node, {
        outcome:
          current && rank(current.outcome) <= rank(item.outcome)
            ? current.outcome
            : item.outcome,
        ports,
      });
    }
    return folded;
  }
}
