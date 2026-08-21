import { describe, expect, it } from "vitest";
import { parseFlowchart } from "./flowchartParser.ts";
import type { GraphModel } from "./graphModel.ts";
import {
  layoutFlowchart,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_NODES,
} from "./layoutFlowchart.ts";

const layoutOf = (source: string) => {
  const model = parseFlowchart(source);
  if (!model) throw new Error("source did not parse");
  const positioned = layoutFlowchart(model);
  if (!positioned) throw new Error("source did not lay out");
  return positioned;
};

const nodeAt = (source: string, id: string) => {
  const node = layoutOf(source).nodes.find((n) => n.id === id);
  if (!node) throw new Error(`no node ${id}`);
  return node;
};

describe("layoutFlowchart - geometry", () => {
  it("gives every node a box inside the graph bounds", () => {
    const graph = layoutOf("flowchart TD\n  A[Start] --> B[Done]");
    expect(graph.nodes).toHaveLength(2);
    for (const node of graph.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
      expect(node.x + node.width).toBeLessThanOrEqual(graph.width);
      expect(node.y + node.height).toBeLessThanOrEqual(graph.height);
    }
  });

  it("ranks top-to-bottom for TD", () => {
    const graph = layoutOf("flowchart TD\n  A --> B");
    const [a, b] = graph.nodes;
    expect(b.y).toBeGreaterThan(a.y);
  });

  it("ranks left-to-right for LR", () => {
    const graph = layoutOf("flowchart LR\n  A --> B");
    const [a, b] = graph.nodes;
    expect(b.x).toBeGreaterThan(a.x);
  });

  it("sizes a node from its label", () => {
    const short = nodeAt("flowchart TD\n  A[Hi] --> B", "A");
    const long = nodeAt(
      "flowchart TD\n  A[A considerably longer label] --> B",
      "A",
    );
    expect(long.width).toBeGreaterThan(short.width);
  });

  it("grows a node's height with its line count", () => {
    const one = nodeAt("flowchart TD\n  A[one] --> B", "A");
    const two = nodeAt("flowchart TD\n  A[one<br/>two] --> B", "A");
    expect(two.height).toBeGreaterThan(one.height);
  });

  it("carries the measured lines through, not the raw ones", () => {
    expect(nodeAt("flowchart TD\n  A[one<br/>two] --> B", "A").lines).toEqual([
      "one",
      "two",
    ]);
  });

  it("keeps the shape on the positioned node", () => {
    expect(nodeAt("flowchart TD\n  A{Ok?} --> B", "A").shape).toBe("diamond");
  });
});

describe("layoutFlowchart - edges", () => {
  it("gives every edge a point list", () => {
    const graph = layoutOf("flowchart TD\n  A --> B --> C");
    expect(graph.edges).toHaveLength(2);
    for (const edge of graph.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("carries style and arrowheads through", () => {
    const edge = layoutOf("flowchart TD\n  A <--> B").edges[0];
    expect(edge.arrowStart).toBe(true);
    expect(edge.arrowEnd).toBe(true);
    expect(edge.style).toBe("solid");
  });

  it("places an edge label with a box", () => {
    const edge = layoutOf("flowchart TD\n  A -->|yes| B").edges[0];
    expect(edge.label).toBeDefined();
    expect(edge.label?.lines).toEqual(["yes"]);
    expect(edge.label?.width).toBeGreaterThan(0);
    expect(edge.label?.height).toBeGreaterThan(0);
    expect(Number.isFinite(edge.label?.x)).toBe(true);
    expect(Number.isFinite(edge.label?.y)).toBe(true);
  });

  it("lays out a cycle", () => {
    expect(() => layoutOf("flowchart TD\n  A --> B --> C --> A")).not.toThrow();
  });

  it("lays out a self-loop", () => {
    expect(layoutOf("flowchart TD\n  A --> A\n  A --> B").edges.length).toBe(2);
  });
});

describe("layoutFlowchart - clusters", () => {
  it("returns a box that contains its members", () => {
    const graph = layoutOf(
      "flowchart TD\n  subgraph s1 [Backend]\n    A --> B\n  end\n  B --> C",
    );
    const cluster = graph.clusters.find((c) => c.id === "s1");
    if (!cluster) throw new Error("no cluster");
    expect(cluster.label).toBe("Backend");
    for (const id of ["A", "B"]) {
      const node = graph.nodes.find((n) => n.id === id);
      if (!node) throw new Error(`no node ${id}`);
      expect(node.x).toBeGreaterThanOrEqual(cluster.x);
      expect(node.y).toBeGreaterThanOrEqual(cluster.y);
      expect(node.x + node.width).toBeLessThanOrEqual(
        cluster.x + cluster.width,
      );
      expect(node.y + node.height).toBeLessThanOrEqual(
        cluster.y + cluster.height,
      );
    }
  });

  it("reports nesting depth so the emitter can shade by level", () => {
    const graph = layoutOf(
      "flowchart TD\n  subgraph outer\n    subgraph inner\n      A --> B\n    end\n  end",
    );
    expect(graph.clusters.find((c) => c.id === "outer")?.depth).toBe(0);
    expect(graph.clusters.find((c) => c.id === "inner")?.depth).toBe(1);
  });

  it("sorts clusters outermost first so they draw behind their children", () => {
    const graph = layoutOf(
      "flowchart TD\n  subgraph outer\n    subgraph inner\n      A --> B\n    end\n  end",
    );
    expect(graph.clusters.map((c) => c.depth)).toEqual([0, 1]);
  });
});

describe("layoutFlowchart - refusing rather than throwing", () => {
  const model = (nodes: number, edges: number): GraphModel => ({
    direction: "TB",
    clusters: [],
    nodes: Array.from({ length: nodes }, (_, i) => ({
      id: `n${i}`,
      lines: [`n${i}`],
      shape: "rect" as const,
    })),
    edges: Array.from({ length: edges }, (_, i) => ({
      from: `n${i % nodes}`,
      to: `n${(i + 1) % nodes}`,
      style: "solid" as const,
      arrowStart: false,
      arrowEnd: true,
    })),
  });

  it("lays out a graph exactly at the node cap", () => {
    expect(layoutFlowchart(model(MAX_GRAPH_NODES, 10))).toBeDefined();
  });

  it("returns undefined above the node cap", () => {
    expect(layoutFlowchart(model(MAX_GRAPH_NODES + 1, 10))).toBeUndefined();
  });

  it("returns undefined above the edge cap", () => {
    expect(layoutFlowchart(model(10, MAX_GRAPH_EDGES + 1))).toBeUndefined();
  });

  it("returns undefined for an empty model", () => {
    expect(
      layoutFlowchart({ direction: "TB", nodes: [], clusters: [], edges: [] }),
    ).toBeUndefined();
  });

  it("returns undefined rather than throwing when an edge names a cluster", () => {
    // graphre throws outright on this; the parser re-targets, but the
    // adapter must never let one slip through into React.
    expect(
      layoutFlowchart({
        direction: "TB",
        nodes: [{ id: "A", lines: ["A"], shape: "rect", parent: "s1" }],
        clusters: [{ id: "s1", label: "s1" }],
        edges: [
          {
            from: "s1",
            to: "A",
            style: "solid",
            arrowStart: false,
            arrowEnd: true,
          },
        ],
      }),
    ).toBeUndefined();
  });

  it("drops an edge naming a node that was never declared", () => {
    const graph = layoutFlowchart({
      direction: "TB",
      nodes: [
        { id: "A", lines: ["A"], shape: "rect" },
        { id: "B", lines: ["B"], shape: "rect" },
      ],
      clusters: [],
      edges: [
        {
          from: "A",
          to: "B",
          style: "solid",
          arrowStart: false,
          arrowEnd: true,
        },
        {
          from: "A",
          to: "ghost",
          style: "solid",
          arrowStart: false,
          arrowEnd: true,
        },
      ],
    });
    expect(graph?.edges).toHaveLength(1);
  });
});
