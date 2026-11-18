import { describe, it } from "vitest";

import { AutomationGraph } from "./AutomationGraph.ts";
import { AutomationGraphBuilder } from "./AutomationGraphBuilder.ts";
import type { AutomationGraphNode } from "./automationGraphNodeSchema.ts";
import type { AutomationGraphValue } from "./automationGraphSchema.ts";
import {
  AutomationOutline,
  type AutomationOutlineBlock,
} from "./AutomationOutline.ts";
import { AutomationVocabulary } from "./AutomationVocabulary.ts";

describe("AutomationOutline", () => {
  const outline = new AutomationOutline();
  const graphs = new AutomationGraph();
  const builder = new AutomationGraphBuilder();
  const entries = new AutomationVocabulary().all();

  const notify = (text = "{{project}}") => ({
    kind: "notify" as const,
    recipient: "0190a000-0000-7000-8000-000000000001",
    channels: ["inbox"],
    title: "Alert",
    text,
    category: "automations" as const,
  });
  const notifyNode = (title = "Alert") => ({
    type: "notify",
    config: {
      recipient: "0190a000-0000-7000-8000-000000000001",
      channels: ["inbox"],
      title,
      text: "{{project}}",
      category: "automations",
    },
  });
  const condition = {
    type: "compare",
    config: { field: "quest_count", operator: "gt", value: 1 },
  };
  /**
   * The ids of a block, read back: events, condition, and each side's
   * sequences.
   */
  const shape = (block: AutomationOutlineBlock) => ({
    events: block.events.map((node) => node.id),
    read: block.read?.id,
    condition: block.condition?.id,
    sequences: block.sequences.map((sequence) =>
      sequence.map((node) => node.id),
    ),
    otherwise: block.otherwise.map((sequence) =>
      sequence.map((node) => node.id),
    ),
  });
  const read = (graph: AutomationGraphValue) => {
    const reading = outline.read(graph);
    if (!reading.outline) throw new Error(reading.message);
    return reading.blocks.map(shape);
  };
  const valid = (graph: AutomationGraphValue) =>
    graphs.check(graph, entries).map((issue) => graphs.message(issue));

  describe("read", () => {
    it("reads a line as one block, its actions one sequence", ({ expect }) => {
      const graph = builder.line({
        source: "epic.completed",
        condition: { field: "quest_count", operator: "gt", value: 1 },
        actions: [notify(), notify()],
      });
      expect(read(graph)).toEqual([
        {
          events: ["source"],
          read: undefined,
          condition: "condition",
          sequences: [["action-1", "action-2"]],
          otherwise: [],
        },
      ]);
    });

    it("reads a compact graph as one block of several events, each action its own sequence", ({
      expect,
    }) => {
      const graph = builder.compact({
        sources: [{ type: "host.offline" }, { type: "host.online" }],
        actions: [
          { type: "notify", config: notifyNode().config },
          { type: "notify", config: notifyNode().config },
        ],
      });
      expect(read(graph)).toEqual([
        {
          events: ["host.offline", "host.online"],
          read: undefined,
          condition: undefined,
          sequences: [["action-1"], ["action-2"]],
          otherwise: [],
        },
      ]);
    });

    it("reads a bell's merged presets as one block each, and a schedule with its read", ({
      expect,
    }) => {
      const prefix = (graph: AutomationGraphValue, key: string) => ({
        nodes: graph.nodes.map((node) => ({
          ...node,
          id: `${key}.${node.id}`,
        })),
        edges: graph.edges.map((edge) => ({
          ...edge,
          from: `${key}.${edge.from}`,
          to: `${key}.${edge.to}`,
        })),
      });
      const offline = prefix(
        builder.line({ source: "host.offline", actions: [notify()] }),
        "host-offline",
      );
      const online = prefix(
        builder.line({ source: "host.online", actions: [notify()] }),
        "host-online",
      );
      const bell: AutomationGraphValue = {
        version: 2,
        nodes: [...offline.nodes, ...online.nodes],
        edges: [...offline.edges, ...online.edges],
      };
      expect(read(bell).map((block) => block.events)).toEqual([
        ["host-offline.source"],
        ["host-online.source"],
      ]);
      const schedule = builder.line({
        source: "schedule",
        cron: "0 9 * * 1",
        read: { key: "quests.remindersDue" },
        actions: [notify()],
      });
      expect(read(schedule)).toEqual([
        {
          events: ["source"],
          read: "read",
          condition: undefined,
          sequences: [["action-1"]],
          otherwise: [],
        },
      ]);
    });

    it("reads a condition with both sides, sequences in the order the runner walks them", ({
      expect,
    }) => {
      const node = (id: string): AutomationGraphNode => ({
        id,
        kind: "action",
        ...notifyNode(),
      });
      const graph: AutomationGraphValue = {
        version: 2,
        nodes: [
          { id: "done", kind: "source", type: "epic.completed", config: {} },
          { id: "big", kind: "condition", ...condition },
          node("yes-b"),
          node("yes-a"),
          node("yes-a-next"),
          node("no"),
        ],
        edges: [
          { from: "done", port: "out", to: "big" },
          { from: "big", port: "true", to: "yes-b" },
          { from: "big", port: "true", to: "yes-a" },
          { from: "yes-a", port: "out", to: "yes-a-next" },
          { from: "big", port: "false", to: "no" },
        ],
      };
      expect(valid(graph)).toEqual([]);
      const [block] = read(graph);
      expect(block.sequences).toEqual([["yes-a", "yes-a-next"], ["yes-b"]]);
      expect(block.otherwise).toEqual([["no"]]);
      const order = graphs.order(graph);
      expect(order.indexOf("yes-a")).toBeLessThan(order.indexOf("yes-b"));
    });

    it("answers that a refused graph is not an outline, without throwing", ({
      expect,
    }) => {
      const graph = builder.line({
        source: "epic.completed",
        actions: [notify(), notify(), notify()],
      });
      const joined: AutomationGraphValue = {
        ...graph,
        edges: [
          ...graph.edges,
          { from: "source", port: "out", to: "action-3" },
        ],
      };
      const reading = outline.read(joined);
      expect(reading.outline).toBe(false);
      expect(reading.outline ? "" : reading.message).toContain(
        "An action has one way in",
      );
      expect(outline.read({ version: 2 } as never).outline).toBe(false);
    });
  });

  describe("edits", () => {
    const empty = (): AutomationGraphValue => ({
      version: 2,
      nodes: [],
      edges: [],
    });
    const start = () =>
      outline.addBlock({ version: 2, nodes: [], edges: [] } as never, {
        type: "epic.completed",
        config: {},
      });

    it("builds a block from empty: an event, actions, a step, a condition and Otherwise", ({
      expect,
    }) => {
      const event = outline.addBlock(empty() as never, {
        type: "epic.completed",
        config: {},
      });
      expect(graphs.structure(event.graph)).toEqual([]);
      const first = outline.addAction(
        event.graph,
        event.id,
        "then",
        notifyNode("first"),
      );
      const second = outline.addAction(
        first.graph,
        event.id,
        "then",
        notifyNode("second"),
      );
      const step = outline.addStep(second.graph, first.id, notifyNode("step"));
      expect(valid(step.graph)).toEqual([]);
      expect(read(step.graph)[0].sequences).toEqual([
        [first.id, step.id],
        [second.id],
      ]);
      const guarded = outline.addCondition(step.graph, event.id, condition);
      const otherwise = outline.addAction(
        guarded.graph,
        event.id,
        "otherwise",
        notifyNode("else"),
      );
      expect(valid(otherwise.graph)).toEqual([]);
      expect(read(otherwise.graph)).toEqual([
        {
          events: [event.id],
          read: undefined,
          condition: guarded.id,
          sequences: [[first.id, step.id], [second.id]],
          otherwise: [[otherwise.id]],
        },
      ]);
    });

    it("inserts a step in the middle of a sequence, and closes the sequence over a removed action", ({
      expect,
    }) => {
      const graph = builder.line({
        source: "epic.completed",
        actions: [notify(), notify()],
      });
      const step = outline.addStep(graph, "action-1", notifyNode());
      expect(read(step.graph)[0].sequences).toEqual([
        ["action-1", step.id, "action-2"],
      ]);
      const removed = outline.removeAction(step.graph, "action-1");
      expect(read(removed)[0].sequences).toEqual([[step.id, "action-2"]]);
      expect(valid(removed)).toEqual([]);
      const last = outline.removeAction(
        outline.removeAction(removed, step.id),
        "action-2",
      );
      expect(read(last)[0].sequences).toEqual([]);
      expect(graphs.structure(last)).toEqual([]);
    });

    it("removes a condition keeping Then, dropping Otherwise", ({ expect }) => {
      const graph = builder.line({
        source: "epic.completed",
        condition: { field: "quest_count", operator: "gt", value: 1 },
        actions: [notify()],
      });
      const otherwise = outline.addAction(
        graph,
        "source",
        "otherwise",
        notifyNode(),
      );
      const removed = outline.removeCondition(otherwise.graph, "source");
      expect(read(removed)).toEqual([
        {
          events: ["source"],
          read: undefined,
          condition: undefined,
          sequences: [["action-1"]],
          otherwise: [],
        },
      ]);
      expect(valid(removed)).toEqual([]);
      expect(() =>
        outline.addAction(removed, "source", "otherwise", notifyNode()),
      ).toThrow("Otherwise needs a condition");
    });

    it("adds and removes an event, a block, and refuses a second block beside a schedule", ({
      expect,
    }) => {
      const graph = builder.line({
        source: "host.offline",
        actions: [notify()],
      });
      const event = outline.addEvent(graph, "source", {
        type: "host.online",
        config: {},
      });
      expect(valid(event.graph)).toEqual([]);
      expect(read(event.graph)[0].events).toEqual(["source", event.id]);
      const block = outline.addBlock(event.graph, {
        type: "epic.completed",
        config: {},
      });
      const action = outline.addAction(
        block.graph,
        block.id,
        "then",
        notifyNode(),
      );
      expect(valid(action.graph)).toEqual([]);
      expect(read(action.graph)).toHaveLength(2);
      expect(read(outline.removeBlock(action.graph, block.id))).toEqual(
        read(event.graph),
      );
      const fewer = outline.removeEvent(event.graph, "source");
      expect(read(fewer)[0].events).toEqual([event.id]);
      expect(outline.removeEvent(fewer, event.id).nodes).toEqual([]);

      const schedule = builder.line({
        source: "schedule",
        cron: "0 9 * * 1",
        read: { key: "quests.remindersDue" },
        actions: [notify()],
      });
      expect(() =>
        outline.addBlock(schedule, { type: "epic.completed", config: {} }),
      ).toThrow("A schedule runs alone");
      expect(() =>
        outline.addEvent(schedule, "source", {
          type: "epic.completed",
          config: {},
        }),
      ).toThrow("A schedule runs alone");
      const fresh = outline.addBlock(
        empty() as never,
        { type: "schedule", config: { cron: "0 9 * * 1" } },
        { type: "quests.remindersDue", config: { filters: {} } },
      );
      expect(read(fresh.graph)[0].read).toBeDefined();
    });

    it("sets a node's config and an event's switch", ({ expect }) => {
      const graph = builder.line({
        source: "host.offline",
        actions: [notify()],
      });
      const off = outline.setEnabled(graph, "source", false);
      expect(off.nodes[0].enabled).toBe(false);
      const configured = outline.setConfig(off, "source", { app: "web" });
      expect(configured.nodes[0].config).toEqual({ app: "web" });
      expect(() => outline.setEnabled(graph, "action-1", false)).toThrow(
        "Only an event has its own switch",
      );
    });

    it("gives a new node an id sorting after every existing one as a string", ({
      expect,
    }) => {
      const graph = builder.line({
        source: "epic.completed",
        actions: [notify()],
      });
      let current = graph;
      const added: string[] = [];
      for (let index = 0; index < 12; index++) {
        const edit = outline.addAction(current, "source", "then", notifyNode());
        const before = current.nodes.map((node) => node.id);
        expect(before.every((id) => id < edit.id)).toBe(true);
        added.push(edit.id);
        current = edit.graph;
        if (index === 3) break;
      }
      expect(read(current)[0].sequences.map((sequence) => sequence[0])).toEqual(
        ["action-1", ...added],
      );
      expect(start().id).toBe("z-completed");
    });

    it("keeps every edit an outline", ({ expect }) => {
      let graph = start().graph;
      const block = read(graph)[0].events[0];
      const edits = [
        (value: AutomationGraphValue) =>
          outline.addAction(value, block, "then", notifyNode()).graph,
        (value: AutomationGraphValue) =>
          outline.addCondition(value, block, condition).graph,
        (value: AutomationGraphValue) =>
          outline.addAction(value, block, "otherwise", notifyNode()).graph,
        (value: AutomationGraphValue) =>
          outline.addEvent(value, block, { type: "epic.completed", config: {} })
            .graph,
        (value: AutomationGraphValue) => {
          const [sequence] = read(value)[0].sequences;
          return outline.addStep(value, sequence[0], notifyNode()).graph;
        },
        (value: AutomationGraphValue) => outline.removeCondition(value, block),
      ];
      for (const edit of edits) {
        graph = edit(graph);
        expect(graphs.structure(graph)).toEqual([]);
        expect(valid(graph)).toEqual([]);
      }
    });
  });

  describe("what is missing", () => {
    const nodeTypes = entries.map((entry) => ({
      type: entry.key,
      kind: (entry.type === "event"
        ? "source"
        : entry.type === "action"
          ? "action"
          : "read") as "source" | "action" | "read",
      ports: ["out" as const],
      fields: entry.fields,
      slots: entry.slots,
      outputs: entry.outputs,
      available: true,
    }));

    it("lists the required fields each node leaves empty, and no more", ({
      expect,
    }) => {
      const block = outline.addBlock(AutomationOutline.EMPTY, {
        type: "epic.completed",
        config: {},
      });
      const quest = nodeTypes.find((item) => item.type === "createQuest")!;
      const tag = nodeTypes.find((item) => item.type === "addTag")!;
      const notifyType = nodeTypes.find((item) => item.type === "notify")!;
      const first = outline.addAction(block.graph, block.id, "then", {
        type: quest.type,
        config: outline.config(quest),
      });
      const second = outline.addStep(first.graph, first.id, {
        type: tag.type,
        config: { ...outline.config(tag), tag: "retro" },
      });
      const guarded = outline.addCondition(second.graph, block.id, {
        type: "compare",
        config: { field: "quest_count", operator: "gt", value: "" },
      });
      const room = outline.addAction(guarded.graph, block.id, "otherwise", {
        type: "notify",
        config: { ...outline.config(notifyType), channels: ["room-1"] },
      });
      expect(outline.unfilled(room.graph, nodeTypes, ["room-1"])).toEqual([
        { node: first.id, slot: "title" },
        { node: first.id, slot: "description" },
        { node: first.id, slot: "area" },
        { node: second.id, slot: "quest" },
        { node: guarded.id, slot: "value" },
        { node: room.id, slot: "title" },
        { node: room.id, slot: "text" },
      ]);
      expect(
        outline
          .unfilled(room.graph, nodeTypes)
          .filter((item) => item.node === room.id)
          .map((item) => item.slot),
      ).toEqual(["title", "text", "recipient"]);
    });

    it("finds the node a refusal names, in the three forms it arrives in", ({
      expect,
    }) => {
      const graph = builder.line({
        source: "epic.completed",
        actions: [notify()],
      });
      const bell: AutomationGraphValue = {
        ...graph,
        nodes: graph.nodes.map((node) => ({
          ...node,
          id: `feedback-created.${node.id}`,
        })),
      };
      expect(outline.nodeOf(graph, { node: "action-1", message: "x" })).toBe(
        "action-1",
      );
      expect(
        outline.nodeOf(graph, {
          message: "nodes.1: node 'action-1': title: Too small",
        }),
      ).toBe("action-1");
      expect(
        outline.nodeOf(bell, {
          message: "feedback-created.action-1[inbox].recipient: not a member",
        }),
      ).toBe("feedback-created.action-1");
      expect(
        outline.nodeOf(graph, { message: "action-1.title: required" }),
      ).toBe("action-1");
      expect(
        outline.nodeOf(graph, { message: "A graph needs a source" }),
      ).toBeUndefined();
    });
  });

  describe("outcomes", () => {
    it("folds a node's rows to the worst outcome and every port taken", ({
      expect,
    }) => {
      const folded = outline.fold([
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
  });
});
