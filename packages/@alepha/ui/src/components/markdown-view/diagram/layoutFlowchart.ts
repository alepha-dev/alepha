import { graphlib, layout } from "graphre";

import type {
  GraphEdgeStyle,
  GraphModel,
  GraphNodeShape,
} from "./graphModel.ts";
import { DIAGRAM_FONT_SIZE, measureLabel, measureNode } from "./textMetrics.ts";

/**
 * The largest graph that gets laid out. Above it the caller falls back to
 * the code block.
 *
 * Measured on an M-series laptop under Node 26, tree-shaped graphs: 50 nodes
 * 8 ms, 200 nodes 31 ms, 500 nodes 106 ms, 1000 nodes 310 ms, 2000 nodes
 * 1.2 s. Phones are several times slower. A pasted graph dump must not be
 * able to freeze the page.
 */
export const MAX_GRAPH_NODES = 200;
export const MAX_GRAPH_EDGES = 400;

export interface PositionedNode {
  id: string;
  /**
   * TOP-LEFT corner, in graph units. graphre reports CENTRES, for nodes and
   * clusters alike; the conversion happens here, once, rather than in the
   * emitter - an emitter half a box off looks almost right, which is the
   * worst way for this to be wrong.
   */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The lines as MEASURED - wrapped and capped. Draw exactly these. */
  lines: string[];
  shape: GraphNodeShape;
}

export interface PositionedCluster {
  id: string;
  label: string;
  /** TOP-LEFT corner, same convention as `PositionedNode`. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0 for an outermost `subgraph`, 1 for one nested inside it, and so on. */
  depth: number;
}

export interface PositionedEdgeLabel {
  lines: string[];
  /** TOP-LEFT corner, same convention as `PositionedNode`. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionedEdge {
  from: string;
  to: string;
  style: GraphEdgeStyle;
  arrowStart: boolean;
  arrowEnd: boolean;
  /** The polyline graphre routed, in order, in graph units. */
  points: Array<{ x: number; y: number }>;
  label?: PositionedEdgeLabel;
}

/**
 * A laid-out flowchart: data, not markup. No SVG, no React, no strings, no
 * DOM. This is the seam that keeps a second emitter possible without
 * redoing the hard part.
 */
export interface PositionedGraph {
  width: number;
  height: number;
  fontSize: number;
  nodes: PositionedNode[];
  /** Outermost first, so an emitter can draw them in order and get z-order free. */
  clusters: PositionedCluster[];
  edges: PositionedEdge[];
}

/**
 * Run `graphre` over a `GraphModel` and read positions back out.
 *
 * Returns `undefined` (never throws, and never returns a partial graph)
 * for an empty model, a model past the caps, or anything graphre refuses.
 * The caller's fallback is the original code block, and graphre must never
 * throw into React.
 *
 * ## Why graphre
 *
 * It is dagre reimplemented in TypeScript with no dependencies: 62 kB
 * unpacked (~15.5 kB gzip) against `@dagrejs/dagre`'s 1.4 MB, same
 * algorithm, compound graphs included. It is frozen (last publish
 * 2022-05, CJS/UMD only, no ESM build) and that is accepted with eyes
 * open - Vite bundles it in both the client and the worker target, and
 * `@dagrejs/dagre` 3.1.1 is the drop-in fallback.
 *
 * **It is imported in this file and nowhere else**, deliberately: plain
 * Node ESM without a bundler sees only the default export, so if the
 * interop ever bites, it is a one-line fix in one place.
 */
export const layoutFlowchart = (
  model: GraphModel,
  fontSize: number = DIAGRAM_FONT_SIZE,
): PositionedGraph | undefined => {
  if (model.nodes.length === 0) return undefined;
  if (model.nodes.length > MAX_GRAPH_NODES) return undefined;
  if (model.edges.length > MAX_GRAPH_EDGES) return undefined;

  try {
    return run(model, fontSize);
  } catch {
    return undefined;
  }
};

const run = (
  model: GraphModel,
  fontSize: number,
): PositionedGraph | undefined => {
  const known = new Set(model.nodes.map((n) => n.id));
  const clusterIds = new Set(model.clusters.map((c) => c.id));

  const g = new graphlib.Graph({ compound: true, multigraph: true });
  g.setGraph({
    rankdir: model.direction,
    nodesep: 36,
    ranksep: 44,
    edgesep: 12,
    marginx: 8,
    marginy: 8,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const sizes = new Map<string, ReturnType<typeof measureNode>>();
  for (const node of model.nodes) {
    const size = measureNode(node, fontSize);
    sizes.set(node.id, size);
    g.setNode(node.id, { width: size.width, height: size.height });
  }

  // A cluster is a node with children, so it must exist before setParent.
  for (const cluster of model.clusters) {
    g.setNode(cluster.id, {});
  }
  for (const cluster of model.clusters) {
    if (cluster.parent && clusterIds.has(cluster.parent)) {
      g.setParent(cluster.id, cluster.parent);
    }
  }
  for (const node of model.nodes) {
    if (node.parent && clusterIds.has(node.parent)) {
      g.setParent(node.id, node.parent);
    }
  }

  // An edge whose endpoint is a cluster id makes graphre throw
  // (`Cannot set properties of undefined (setting 'rank')`), the same
  // limitation dagre has. The parser re-targets those, so one arriving here
  // is a parser bug - refuse the whole layout rather than draw a graph
  // missing an edge nobody will notice is missing.
  if (model.edges.some((e) => clusterIds.has(e.from) || clusterIds.has(e.to))) {
    return undefined;
  }

  // An edge naming a node that was never declared is a different case: it is
  // ordinary malformed input, and dropping it costs one arrow.
  const edges = model.edges.filter((e) => known.has(e.from) && known.has(e.to));

  const labels = new Map<string, PositionedEdgeLabel>();
  edges.forEach((edge, index) => {
    const name = String(index);
    const label = edge.label
      ? measureLabel(edge.label.split("\n"), fontSize)
      : undefined;
    g.setEdge(
      { v: edge.from, w: edge.to, name },
      label
        ? {
            width: label.width + EDGE_LABEL_PAD * 2,
            height: label.height + EDGE_LABEL_PAD,
            labelpos: "c" as never,
          }
        : {},
    );
    if (label) {
      labels.set(name, {
        lines: label.lines,
        x: 0,
        y: 0,
        width: label.width + EDGE_LABEL_PAD * 2,
        height: label.height + EDGE_LABEL_PAD,
      });
    }
  });

  layout(g as never);

  const graphLabel = g.graph() as { width?: number; height?: number };
  const width = graphLabel.width;
  const height = graphLabel.height;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;

  const nodes: PositionedNode[] = [];
  for (const node of model.nodes) {
    const laid = g.node(node.id) as
      | { x?: number; y?: number; width?: number; height?: number }
      | undefined;
    const size = sizes.get(node.id);
    if (
      !laid ||
      !size ||
      !Number.isFinite(laid.x) ||
      !Number.isFinite(laid.y)
    ) {
      return undefined;
    }
    nodes.push({
      id: node.id,
      x: (laid.x as number) - size.width / 2,
      y: (laid.y as number) - size.height / 2,
      width: size.width,
      height: size.height,
      lines: size.lines,
      shape: node.shape,
    });
  }

  const clusters: PositionedCluster[] = [];
  for (const cluster of model.clusters) {
    const laid = g.node(cluster.id) as
      | { x?: number; y?: number; width?: number; height?: number }
      | undefined;
    if (!laid || !Number.isFinite(laid.x) || !Number.isFinite(laid.y)) continue;
    const boxWidth = laid.width ?? 0;
    const boxHeight = laid.height ?? 0;
    clusters.push({
      id: cluster.id,
      label: cluster.label,
      x: (laid.x as number) - boxWidth / 2,
      y: (laid.y as number) - boxHeight / 2,
      width: boxWidth,
      height: boxHeight,
      depth: depthOf(cluster.id, model),
    });
  }
  // Outermost first: an emitter that draws them in order gets z-order for
  // free, with no per-element z-index to keep in sync.
  clusters.sort((a, b) => a.depth - b.depth);

  const positionedEdges: PositionedEdge[] = [];
  edges.forEach((edge, index) => {
    const name = String(index);
    const laid = g.edge({ v: edge.from, w: edge.to, name }) as
      | { points?: Array<{ x: number; y: number }>; x?: number; y?: number }
      | undefined;
    const points = laid?.points?.filter(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
    );
    if (!points || points.length < 2) return;

    const label = labels.get(name);
    positionedEdges.push({
      from: edge.from,
      to: edge.to,
      style: edge.style,
      arrowStart: edge.arrowStart,
      arrowEnd: edge.arrowEnd,
      points,
      ...(label && Number.isFinite(laid?.x) && Number.isFinite(laid?.y)
        ? {
            label: {
              ...label,
              x: (laid?.x as number) - label.width / 2,
              y: (laid?.y as number) - label.height / 2,
            },
          }
        : {}),
    });
  });

  return {
    width: width as number,
    height: height as number,
    fontSize,
    nodes,
    clusters,
    edges: positionedEdges,
  };
};

/**
 * Breathing room around an edge label, so the line does not run into the
 * text before the emitter's chip covers it.
 */
const EDGE_LABEL_PAD = 6;

const depthOf = (id: string, model: GraphModel): number => {
  let depth = 0;
  let current = model.clusters.find((c) => c.id === id)?.parent;
  // Bounded by the cluster count: a malformed parent cycle must not hang.
  while (current && depth <= model.clusters.length) {
    depth++;
    current = model.clusters.find((c) => c.id === current)?.parent;
  }
  return depth;
};
