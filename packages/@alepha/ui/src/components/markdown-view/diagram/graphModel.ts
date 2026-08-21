/**
 * The direction a flowchart ranks in, in the spelling the layout engine
 * uses. Mermaid's `TD` is folded into `TB` at parse time so nothing
 * downstream has to know they are the same thing.
 */
export type GraphDirection = "TB" | "BT" | "LR" | "RL";

/**
 * The four shapes the emitter draws. Every other mermaid bracket pair is
 * consumed by the parser and mapped onto the nearest of these, so a diagram
 * using a cylinder or a stadium still renders, with a clean label.
 */
export type GraphNodeShape = "rect" | "rounded" | "diamond" | "circle";

/**
 * How an edge is stroked. `-.->` is dashed, `==>` is thick, everything else
 * is solid.
 */
export type GraphEdgeStyle = "solid" | "dashed" | "thick";

export interface GraphNode {
  id: string;
  /** The label, already split on `<br/>`. Never empty: a bare id is its own label. */
  lines: string[];
  shape: GraphNodeShape;
  /** The id of the enclosing `subgraph`, if any. */
  parent?: string;
}

export interface GraphCluster {
  id: string;
  label: string;
  /** The id of the enclosing `subgraph`, for nested ones. */
  parent?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** May contain `\n` when the author wrote `<br/>`. */
  label?: string;
  style: GraphEdgeStyle;
  arrowStart: boolean;
  arrowEnd: boolean;
  /**
   * Set when the author pointed the edge at a `subgraph` id and the parser
   * re-targeted it to a member node: graphre throws on an edge whose
   * endpoint is a cluster. Kept so an emitter could one day draw to the
   * cluster border instead of to the member it landed on.
   */
  fromCluster?: string;
  toCluster?: string;
}

/**
 * A flowchart as data: what the parser produces and the layout adapter
 * consumes. Nothing positional, nothing rendered, no DOM.
 */
export interface GraphModel {
  direction: GraphDirection;
  nodes: GraphNode[];
  clusters: GraphCluster[];
  edges: GraphEdge[];
}
