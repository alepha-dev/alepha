import { describe, it } from "vitest";

import { AutomationGraph } from "../../../../../../api/schemas/AutomationGraph.ts";
import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import { AutomationCanvasMap } from "./AutomationCanvasMap.ts";

const notify = (id: string) => ({
  id,
  kind: "action" as const,
  type: "notify",
  config: {
    channels: ["inbox"],
    title: "t",
    text: "x",
    category: "automations",
  },
});

const branching = (): AutomationGraphValue => ({
  version: 2,
  nodes: [
    { id: "offline", kind: "source", type: "host.offline", config: {} },
    { id: "online", kind: "source", type: "host.online", config: {} },
    {
      id: "bay",
      kind: "condition",
      type: "compare",
      config: { field: "kind", operator: "eq", value: "bay" },
    },
    notify("yes"),
    notify("no"),
    notify("back"),
  ],
  edges: [
    { from: "offline", port: "out", to: "bay" },
    { from: "bay", port: "true", to: "yes" },
    { from: "bay", port: "false", to: "no" },
    { from: "online", port: "out", to: "back" },
  ],
});

describe("AutomationCanvasMap", () => {
  const map = new AutomationCanvasMap();

  it("lays out a graph saved without positions, one node per graph node by kind", ({
    expect,
  }) => {
    const { nodes, edges } = map.map({ graph: branching() });
    const laid = AutomationGraph.layout(branching());
    expect(nodes.map((node) => [node.id, node.type, node.position])).toEqual(
      laid.nodes.map((node) => [node.id, node.kind, node.position]),
    );
    expect(nodes.every((node) => node.data.painted === false)).toBe(true);
    expect(
      edges.map((edge) => [edge.source, edge.sourceHandle, edge.target]),
    ).toEqual([
      ["offline", "out", "bay"],
      ["bay", "true", "yes"],
      ["bay", "false", "no"],
      ["online", "out", "back"],
    ]);
    expect(edges.every((edge) => edge.targetHandle === "in")).toBe(true);
    expect(edges.every((edge) => edge.data?.walked === undefined)).toBe(true);
  });

  it("keeps stored positions and marks the selected node", ({ expect }) => {
    const graph = AutomationGraph.layout(branching());
    graph.nodes[0].position = { x: -40, y: 900 };
    const { nodes } = map.map({ graph, selected: "bay" });
    expect(nodes[0].position).toEqual({ x: -40, y: 900 });
    expect(
      nodes.filter((node) => node.selected).map((node) => node.id),
    ).toEqual(["bay"]);
  });

  it("carries each source's switch and health", ({ expect }) => {
    const { nodes } = map.map({
      graph: branching(),
      sources: [
        {
          node: "offline",
          type: "host.offline",
          enabled: true,
          health: "active",
        },
        {
          node: "online",
          type: "host.online",
          enabled: false,
          health: "broken",
          reason: "Bay is off",
        },
      ],
    });
    const online = nodes.find((node) => node.id === "online")!;
    expect(online.data.source).toMatchObject({
      enabled: false,
      reason: "Bay is off",
    });
    expect(
      nodes.find((node) => node.id === "bay")!.data.source,
    ).toBeUndefined();
  });

  it("paints a run: outcomes, the port a condition took, and the edges walked", ({
    expect,
  }) => {
    const { nodes, edges } = map.map({
      graph: branching(),
      outcomes: [
        { node: "offline", outcome: "ran" },
        { node: "bay", outcome: "ran", port: "true" },
        { node: "no", outcome: "skipped" },
        { node: "yes", outcome: "failed" },
      ],
    });
    const data = Object.fromEntries(nodes.map((node) => [node.id, node.data]));
    expect(data.bay).toMatchObject({
      outcome: "ran",
      ports: ["true"],
      painted: true,
    });
    expect(data.yes.outcome).toBe("failed");
    expect(data.online.outcome).toBeUndefined();
    expect(
      Object.fromEntries(edges.map((edge) => [edge.id, edge.data?.walked])),
    ).toEqual({
      "offline:out:bay": true,
      "bay:true:yes": true,
      "bay:false:no": false,
      "online:out:back": false,
    });
  });

  it("folds a node's rows to the worst outcome and every port taken", ({
    expect,
  }) => {
    const folded = map.fold([
      { node: "bay", row: 0, outcome: "ran", port: "true" },
      { node: "bay", row: 1, outcome: "ran", port: "false" },
      { node: "tell", row: 0, outcome: "ran" },
      { node: "tell", row: 1, outcome: "unknown" },
      { node: "tell", row: 2, outcome: "refused" },
      { node: "later", row: 0, outcome: "not_reached" },
      { node: "later", row: 1, outcome: "skipped" },
    ]);
    expect(folded.get("bay")).toEqual({
      outcome: "ran",
      ports: ["false", "true"],
    });
    expect(folded.get("tell")?.outcome).toBe("unknown");
    expect(folded.get("later")?.outcome).toBe("skipped");
  });

  it("carries each node's issues in the editor", ({ expect }) => {
    const { nodes } = map.map({
      graph: branching(),
      issues: { bay: ["'kind' is not a field"], yes: [] },
    });
    const data = Object.fromEntries(nodes.map((node) => [node.id, node.data]));
    expect(data.bay.issues).toEqual(["'kind' is not a field"]);
    expect(data.yes.issues).toBeUndefined();
  });
});
