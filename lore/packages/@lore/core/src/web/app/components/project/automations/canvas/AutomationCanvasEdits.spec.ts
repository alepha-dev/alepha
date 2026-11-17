import { describe, it } from "vitest";

import type { AutomationCatalogNodeType } from "../../../../../../api/schemas/automationCatalogNodeTypeSchema.ts";
import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import { AutomationCanvasEdits } from "./AutomationCanvasEdits.ts";

const type = (
  kind: AutomationCatalogNodeType["kind"],
  key: string,
  slots: AutomationCatalogNodeType["slots"] = {},
): AutomationCatalogNodeType => ({
  type: key,
  kind,
  ports: kind === "condition" ? ["true", "false"] : ["out"],
  fields: {},
  slots,
  available: true,
});

const notify = type("action", "notify", {
  recipient: { kind: "member", required: false },
  channel: { kind: "channel", required: true },
  title: { kind: "text", required: true },
  text: { kind: "text", required: true },
  category: { kind: "text", required: true, values: ["automations"] },
});

const graph = (): AutomationGraphValue => ({
  version: 2,
  nodes: [
    {
      id: "offline",
      kind: "source",
      type: "host.offline",
      config: {},
      position: { x: 0, y: 0 },
    },
    {
      id: "nightly",
      kind: "source",
      type: "schedule",
      config: { cron: "0 9 * * *" },
      position: { x: 0, y: 140 },
    },
    {
      id: "open",
      kind: "read",
      type: "quests.open",
      config: { filters: {} },
      position: { x: 280, y: 140 },
    },
    {
      id: "bay",
      kind: "condition",
      type: "compare",
      config: {},
      position: { x: 280, y: 0 },
    },
    {
      id: "tell",
      kind: "action",
      type: "notify",
      config: {},
      position: { x: 560, y: 0 },
    },
  ],
  edges: [
    { from: "offline", port: "out", to: "bay" },
    { from: "bay", port: "true", to: "tell" },
    { from: "nightly", port: "out", to: "open" },
  ],
});

describe("AutomationCanvasEdits", () => {
  const edits = new AutomationCanvasEdits();

  it("names a new node after its type, unique in the graph", ({ expect }) => {
    expect(edits.id(graph(), "notify")).toBe("notify");
    expect(edits.id(graph(), "host.offline")).toBe("offline-2");
    expect(edits.id(graph(), "quality.coverage.lines")).toBe("lines");
  });

  it("starts a node with what its type needs filled", ({ expect }) => {
    expect(edits.config(notify)).toEqual({
      recipient: "",
      channels: ["inbox"],
      title: "",
      text: "",
      category: "automations",
    });
    expect(edits.config(type("source", "schedule"))).toEqual({
      cron: "0 9 * * *",
    });
    expect(edits.config(type("read", "quests.open"))).toEqual({ filters: {} });
    expect(edits.config(type("condition", "compare"))).toEqual({
      field: "",
      operator: "eq",
      value: "",
    });
  });

  it("refuses every wire the graph would refuse, with its reason", ({
    expect,
  }) => {
    const refuse = (from: string, port: "out" | "true" | "false", to: string) =>
      edits.refuse(graph(), { from, port, to });
    expect(refuse("tell", "out", "tell")).toBe("self");
    expect(refuse("offline", "out", "bay")).toBe("duplicate");
    expect(refuse("bay", "out", "tell")).toBe("port");
    expect(refuse("offline", "true", "tell")).toBe("port");
    expect(refuse("bay", "false", "offline")).toBe("intoSource");
    expect(refuse("offline", "out", "open")).toBe("readAfterEvent");
    expect(refuse("nightly", "out", "bay")).toBe("scheduleToRead");
    expect(refuse("tell", "out", "bay")).toBe("conditionAfterAction");
    expect(refuse("bay", "false", "tell")).toBeUndefined();
    expect(refuse("open", "out", "tell")).toBeUndefined();
  });

  it("refuses a cycle, a second way into a read and a sixth action under one source", ({
    expect,
  }) => {
    let next = graph();
    expect(
      edits.refuse(
        {
          ...next,
          nodes: [
            ...next.nodes,
            { id: "other", kind: "source", type: "schedule", config: {} },
          ],
        },
        { from: "other", port: "out", to: "open" },
      ),
    ).toBe("readOneWay");
    next = edits.connect(next, { from: "tell", port: "out", to: "tell-2" });
    next.nodes.push({
      id: "tell-2",
      kind: "action",
      type: "notify",
      config: {},
    });
    expect(
      edits.refuse(next, { from: "tell-2", port: "out", to: "tell" }),
    ).toBe("cycle");
    let chain = graph();
    let last = "tell";
    for (let index = 0; index < 4; index++) {
      const added = edits.add(chain, notify, { node: last, port: "out" });
      chain = added.graph;
      last = added.id;
    }
    const sixth = edits.add(chain, notify);
    expect(sixth.graph.edges).toHaveLength(chain.edges.length);
    expect(
      edits.refuse(sixth.graph, { from: last, port: "out", to: sixth.id }),
    ).toBe("actions");
  });

  it("adds a node wired from a handle, placed right of it", ({ expect }) => {
    const { graph: next, id } = edits.add(graph(), notify, {
      node: "bay",
      port: "false",
    });
    expect(id).toBe("notify");
    expect(next.edges).toContainEqual({
      from: "bay",
      port: "false",
      to: "notify",
    });
    const node = next.nodes.find((item) => item.id === "notify")!;
    expect(node.position?.x).toBe(560);
    expect(node.position!.y).toBeGreaterThan(0);
  });

  it("lists the types that may follow a port", ({ expect }) => {
    const types = [
      type("source", "host.online"),
      type("read", "quests.open"),
      type("condition", "compare"),
      notify,
    ];
    expect(
      edits
        .followers(graph(), "offline", "out", types)
        .map((item) => item.type),
    ).toEqual(["compare", "notify"]);
    expect(
      edits.followers(graph(), "tell", "out", types).map((item) => item.type),
    ).toEqual(["notify"]);
  });

  it("removes nodes with their wires, and wires by id", ({ expect }) => {
    const next = edits.remove(graph(), {
      nodes: ["bay"],
      edges: ["nightly:out:open"],
    });
    expect(next.nodes.map((node) => node.id)).not.toContain("bay");
    expect(next.edges).toEqual([]);
  });

  it("moves nodes to whole positions", ({ expect }) => {
    const next = edits.move(graph(), { tell: { x: 600.4, y: 20.6 } });
    expect(next.nodes.find((node) => node.id === "tell")?.position).toEqual({
      x: 600,
      y: 21,
    });
  });
});
