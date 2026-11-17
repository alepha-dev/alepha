import type { AutomationCatalogNodeType } from "../../../../../../api/schemas/automationCatalogNodeTypeSchema.ts";
import { AutomationGraph } from "../../../../../../api/schemas/AutomationGraph.ts";
import type { AutomationGraphEdge } from "../../../../../../api/schemas/automationGraphEdgeSchema.ts";
import type { AutomationGraphNode } from "../../../../../../api/schemas/automationGraphNodeSchema.ts";
import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import { AutomationVocabulary } from "../../../../../../api/schemas/AutomationVocabulary.ts";

/**
 * Why a wire is refused while it is dragged (#Q3811), as a key the canvas
 * turns into words.
 */
export type AutomationWireRefusal =
  | "self"
  | "duplicate"
  | "port"
  | "intoSource"
  | "readAfterEvent"
  | "readOneWay"
  | "scheduleToRead"
  | "scheduleOneRead"
  | "conditionAfterAction"
  | "cycle"
  | "actions";

export type AutomationPosition = { x: number; y: number };

/**
 * The canvas editor's operations on a draft graph (#Q3811), pure: each one
 * takes a graph and returns a new one, so the draft's history is a list of
 * graphs and the spec needs no React.
 *
 * The rules a wire is refused by are the graph's own (`AutomationGraph`),
 * asked of one wire before it exists: what `check` would say once it is
 * there, said while it is dragged.
 */
export class AutomationCanvasEdits {
  protected readonly graphs = new AutomationGraph();

  /**
   * An id for a new node of `type`, unique in the graph: the type's last
   * word, then `-2`, `-3`.
   */
  public id(graph: AutomationGraphValue, type: string): string {
    const base =
      type
        .split(".")
        .pop()!
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 56) || "node";
    const taken = new Set(graph.nodes.map((node) => node.id));
    let candidate = base;
    for (let index = 2; taken.has(candidate); index++)
      candidate = `${base}-${index}`;
    return candidate;
  }

  /**
   * A new node's configuration: what its type needs filled, empty or at
   * its default, so the graph's check names what is left to do.
   */
  public config(nodeType: AutomationCatalogNodeType): Record<string, unknown> {
    if (nodeType.kind === "source")
      return nodeType.type === AutomationVocabulary.SCHEDULE
        ? { cron: "0 9 * * *" }
        : {};
    if (nodeType.kind === "read") return { filters: {} };
    if (nodeType.kind === "condition")
      return { field: "", operator: "eq", value: "" };
    const config: Record<string, unknown> = {};
    for (const [name, slot] of Object.entries(nodeType.slots)) {
      if (!slot.required && slot.default === undefined) continue;
      config[name] =
        slot.default ??
        (name === "category"
          ? "automations"
          : slot.kind === "number" || slot.kind === "release"
            ? 0
            : slot.kind === "boolean"
              ? false
              : "");
    }
    if (nodeType.type === "notify") {
      delete config.channel;
      config.recipient = "";
      config.channels = ["inbox"];
    }
    return config;
  }

  /**
   * The ports a node of this kind leaves by.
   */
  public ports(
    kind: AutomationGraphNode["kind"],
  ): AutomationGraphEdge["port"][] {
    return kind === "condition" ? ["true", "false"] : ["out"];
  }

  /**
   * Where a new node goes: right of the node it is wired from, below what
   * that node already leads to; otherwise a source in the first column and
   * anything else right of the rightmost node, each below its column.
   */
  public place(
    graph: AutomationGraphValue,
    kind: AutomationGraphNode["kind"],
    from?: string,
  ): AutomationPosition {
    const at = (id: string) =>
      graph.nodes.find((node) => node.id === id)?.position ?? { x: 0, y: 0 };
    const x = from
      ? at(from).x + AutomationGraph.COLUMN_WIDTH
      : kind === "source" || graph.nodes.length === 0
        ? 0
        : Math.max(...graph.nodes.map((node) => node.position?.x ?? 0)) +
          AutomationGraph.COLUMN_WIDTH;
    const below = graph.nodes
      .map((node) => node.position)
      .filter(
        (position): position is AutomationPosition =>
          !!position &&
          Math.abs(position.x - x) < AutomationGraph.COLUMN_WIDTH / 2,
      )
      .map((position) => position.y);
    const y = from
      ? Math.max(
          at(from).y,
          below.length
            ? Math.max(...below) + AutomationGraph.ROW_HEIGHT
            : at(from).y,
        )
      : below.length
        ? Math.max(...below) + AutomationGraph.ROW_HEIGHT
        : 0;
    return { x, y };
  }

  /**
   * The graph with a new node of `nodeType`, placed, and wired from `from`
   * when one is given and the wire is allowed.
   */
  public add(
    graph: AutomationGraphValue,
    nodeType: AutomationCatalogNodeType,
    from?: { node: string; port: AutomationGraphEdge["port"] },
  ): { graph: AutomationGraphValue; id: string } {
    const id = this.id(graph, nodeType.type);
    const node: AutomationGraphNode = {
      id,
      kind: nodeType.kind,
      type: nodeType.type,
      config: this.config(nodeType),
      position: this.place(graph, nodeType.kind, from?.node),
    };
    let next: AutomationGraphValue = {
      ...graph,
      nodes: [...graph.nodes, node],
    };
    if (
      from &&
      !this.refuse(next, { from: from.node, port: from.port, to: id })
    )
      next = this.connect(next, { from: from.node, port: from.port, to: id });
    return { graph: next, id };
  }

  /**
   * Why `edge` may not be added to `graph`, or nothing when it may.
   */
  public refuse(
    graph: AutomationGraphValue,
    edge: AutomationGraphEdge,
  ): AutomationWireRefusal | undefined {
    const from = this.graphs.node(graph, edge.from);
    const to = this.graphs.node(graph, edge.to);
    if (!from || !to || from.id === to.id) return "self";
    if (
      graph.edges.some(
        (item) =>
          item.from === edge.from &&
          item.port === edge.port &&
          item.to === edge.to,
      )
    )
      return "duplicate";
    if (from.kind === "condition" ? edge.port === "out" : edge.port !== "out")
      return "port";
    if (to.kind === "source") return "intoSource";
    const schedule =
      from.kind === "source" && from.type === AutomationVocabulary.SCHEDULE;
    if (to.kind === "read") {
      if (!schedule) return "readAfterEvent";
      if (this.graphs.incoming(graph, to.id).length) return "readOneWay";
    }
    if (schedule) {
      if (to.kind !== "read") return "scheduleToRead";
      if (this.graphs.outgoing(graph, from.id).length) return "scheduleOneRead";
    }
    if (to.kind === "condition" && from.kind === "action")
      return "conditionAfterAction";
    if (this.graphs.reachable(graph, to.id).has(from.id)) return "cycle";
    const next = this.connect(graph, edge);
    for (const source of this.graphs.sources(next)) {
      const actions = [...this.graphs.reachable(next, source.id)].filter(
        (id) => this.graphs.node(next, id)?.kind === "action",
      );
      if (actions.length > AutomationGraph.MAX_ACTIONS_PER_SOURCE)
        return "actions";
    }
    return undefined;
  }

  public connect(
    graph: AutomationGraphValue,
    edge: AutomationGraphEdge,
  ): AutomationGraphValue {
    return { ...graph, edges: [...graph.edges, edge] };
  }

  /**
   * The graph without these nodes, their wires, and these wires (by the
   * canvas's `from:port:to` id).
   */
  public remove(
    graph: AutomationGraphValue,
    removed: { nodes?: string[]; edges?: string[] },
  ): AutomationGraphValue {
    const nodes = new Set(removed.nodes ?? []);
    const edges = new Set(removed.edges ?? []);
    return {
      ...graph,
      nodes: graph.nodes.filter((node) => !nodes.has(node.id)),
      edges: graph.edges.filter(
        (edge) =>
          !nodes.has(edge.from) &&
          !nodes.has(edge.to) &&
          !edges.has(this.edgeId(edge)),
      ),
    };
  }

  public edgeId(edge: AutomationGraphEdge): string {
    return `${edge.from}:${edge.port}:${edge.to}`;
  }

  public move(
    graph: AutomationGraphValue,
    positions: Record<string, AutomationPosition>,
  ): AutomationGraphValue {
    return {
      ...graph,
      nodes: graph.nodes.map((node) =>
        positions[node.id]
          ? {
              ...node,
              position: {
                x: Math.round(positions[node.id].x),
                y: Math.round(positions[node.id].y),
              },
            }
          : node,
      ),
    };
  }

  /**
   * The graph with one node changed by `change`.
   */
  public update(
    graph: AutomationGraphValue,
    id: string,
    change: (node: AutomationGraphNode) => AutomationGraphNode,
  ): AutomationGraphValue {
    return {
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === id ? change(node) : node)),
    };
  }

  /**
   * Another type for an action, its configuration reset to the new type's.
   */
  public retype(
    graph: AutomationGraphValue,
    id: string,
    nodeType: AutomationCatalogNodeType,
  ): AutomationGraphValue {
    return this.update(graph, id, (node) => ({
      ...node,
      type: nodeType.type,
      config: this.config(nodeType),
    }));
  }

  /**
   * The prefix a preset's nodes take when added to this graph (#Q3812): its
   * key, or `<key>-2`, `<key>-3` once a copy is there.
   */
  public prefix(graph: AutomationGraphValue, key: string): string {
    const taken = (prefix: string) =>
      graph.nodes.some((node) => node.id.startsWith(`${prefix}.`));
    let candidate = key;
    for (let index = 2; taken(candidate); index++)
      candidate = `${key}-${index}`;
    return candidate;
  }

  /**
   * The graph with another one's nodes and wires added, placed below what
   * is there: a preset added to a draft (#Q3812).
   */
  public merge(
    graph: AutomationGraphValue,
    addition: AutomationGraphValue,
  ): AutomationGraphValue {
    const below = graph.nodes.length
      ? Math.max(...graph.nodes.map((node) => node.position?.y ?? 0)) +
        AutomationGraph.ROW_HEIGHT
      : 0;
    return {
      ...graph,
      nodes: [
        ...graph.nodes,
        ...addition.nodes.map((node) => ({
          ...node,
          position: {
            x: node.position?.x ?? 0,
            y: (node.position?.y ?? 0) + below,
          },
        })),
      ],
      edges: [...graph.edges, ...addition.edges],
    };
  }

  /**
   * Which of a node's ports a new wire may start from, and the node types
   * that may follow it (#Q3811's "+").
   */
  public followers(
    graph: AutomationGraphValue,
    from: string,
    port: AutomationGraphEdge["port"],
    nodeTypes: readonly AutomationCatalogNodeType[],
  ): AutomationCatalogNodeType[] {
    return nodeTypes.filter((nodeType) => {
      if (nodeType.kind === "source" || nodeType.kind === "transform")
        return false;
      const { graph: next, id } = this.add(graph, nodeType);
      return !this.refuse(next, { from, port, to: id });
    });
  }
}
