import { describe, it } from "vitest";

import type { AutomationDescriptor } from "./automationDescriptorSchema.ts";
import { AutomationGraph } from "./AutomationGraph.ts";
import type { AutomationGraphNode } from "./automationGraphNodeSchema.ts";
import {
  automationGraphSchema,
  type AutomationGraphValue,
} from "./automationGraphSchema.ts";
import type { AutomationSlotKind } from "./automationSlotKindSchema.ts";
import { AutomationVocabulary } from "./AutomationVocabulary.ts";

describe("AutomationGraph", () => {
  const coverage: AutomationDescriptor = {
    key: "quality.coverage",
    type: "metric",
    result: "scalar",
    fields: { project: "text", title: "text", url: "text", value: "number" },
    slots: {},
    permissions: [],
    needs: [],
    operators: ["eq", "ne", "lt", "lte", "gt", "gte", "crossesAbove", "delta"],
  };
  const entries = [...new AutomationVocabulary().all(), coverage];
  const graphs = new AutomationGraph();

  const notify = (
    id: string,
    text = "{{project}}",
    extra: Record<string, unknown> = {},
  ): AutomationGraphNode => ({
    id,
    kind: "action",
    type: "notify",
    config: {
      recipient: "{{recipient}}",
      channels: ["inbox", "email"],
      title: "Alert",
      text,
      category: "automations",
      ...extra,
    },
  });
  const event = (id: string, type: string): AutomationGraphNode => ({
    id,
    kind: "source",
    type,
    config: {},
  });
  const graph = (
    nodes: AutomationGraphNode[],
    edges: [string, string, string?][],
  ): AutomationGraphValue => ({
    version: 2,
    nodes,
    edges: edges.map(([from, to, port]) => ({
      from,
      to,
      port: (port ?? "out") as "out",
    })),
  });
  const messages = (value: unknown) =>
    graphs.check(value, entries).map((issue) => graphs.message(issue));

  describe("schema", () => {
    it("parses a graph and refuses the reserved transform kind", ({
      expect,
    }) => {
      const value = graph(
        [event("offline", "host.offline"), notify("notify")],
        [["offline", "notify"]],
      );
      expect(automationGraphSchema.parse(value)).toEqual(value);
      expect(messages(value)).toEqual([]);
      const transform = graph(
        [
          event("offline", "host.offline"),
          { id: "ai", kind: "transform", type: "summarize", config: {} },
          notify("notify"),
        ],
        [
          ["offline", "ai"],
          ["ai", "notify"],
        ],
      );
      expect(messages(transform).join("\n")).toContain(
        "the 'transform' kind is reserved",
      );
    });

    it("refuses a duplicate node, a bad id, a repeated wire and a malformed config", ({
      expect,
    }) => {
      expect(
        messages(
          graph([event("a", "host.offline"), event("a", "host.online")], []),
        ).join("\n"),
      ).toContain("node 'a' is declared twice");
      expect(
        messages(graph([event("Bad Id", "host.offline")], [])).join("\n"),
      ).toContain("A node id is 1 to 64");
      expect(
        messages(
          graph(
            [event("a", "host.offline"), notify("n")],
            [
              ["a", "n"],
              ["a", "n"],
            ],
          ),
        ).join("\n"),
      ).toContain("is declared twice");
      expect(
        messages(
          graph(
            [
              { ...event("a", "host.offline"), config: { cron: "* * * * *" } },
              notify("n"),
            ],
            [["a", "n"]],
          ),
        ).join("\n"),
      ).toContain("node 'a'");
      expect(
        messages(
          graph(
            [event("a", "host.offline"), { ...notify("n"), enabled: false }],
            [["a", "n"]],
          ),
        ).join("\n"),
      ).toContain("only a source has its own switch");
    });
  });

  describe("structure", () => {
    it("takes 1 to 8 sources", ({ expect }) => {
      expect(messages(graph([notify("n")], []))).toContain(
        "A graph needs a source",
      );
      const many = Array.from({ length: 9 }, (_, index) =>
        event(`s${index}`, "host.offline"),
      );
      expect(
        messages(
          graph(
            [...many, notify("n")],
            many.map((source) => [source.id, "n"]),
          ),
        ),
      ).toContain("A graph holds at most 8 sources");
    });

    it("keeps a schedule alone with its one read", ({ expect }) => {
      const schedule: AutomationGraphNode = {
        id: "every-day",
        kind: "source",
        type: "schedule",
        config: { cron: "0 9 * * 1" },
      };
      const read: AutomationGraphNode = {
        id: "open",
        kind: "read",
        type: "quests.open",
        config: { filters: {} },
      };
      expect(
        messages(
          graph(
            [schedule, read, notify("n", "{{title}} #{{shortId}}")],
            [
              ["every-day", "open"],
              ["open", "n"],
            ],
          ),
        ),
      ).toEqual([]);
      expect(
        messages(
          graph(
            [schedule, read, event("offline", "host.offline"), notify("n")],
            [
              ["every-day", "open"],
              ["open", "n"],
              ["offline", "n"],
            ],
          ),
        ),
      ).toContain(
        "node 'every-day': A schedule is the only source of its automation: give the other sources an automation of their own",
      );
      expect(
        messages(graph([schedule, notify("n")], [["every-day", "n"]])),
      ).toContain(
        "node 'every-day': A schedule is followed by its read, and nothing else",
      );
      expect(
        messages(
          graph(
            [event("offline", "host.offline"), read, notify("n")],
            [
              ["offline", "open"],
              ["open", "n"],
            ],
          ),
        ),
      ).toContain(
        "node 'open': An event brings its own fields: a read follows a schedule only",
      );
    });

    it("refuses a wire into a source, a cycle and an unreachable node", ({
      expect,
    }) => {
      expect(
        messages(
          graph(
            [
              event("a", "host.offline"),
              event("b", "host.online"),
              notify("n"),
            ],
            [
              ["a", "b"],
              ["b", "n"],
            ],
          ),
        ),
      ).toContain(
        "node 'b': Nothing wires into a source: a source starts a run",
      );
      expect(
        messages(
          graph(
            [event("a", "host.offline"), notify("n1"), notify("n2")],
            [
              ["a", "n1"],
              ["n1", "n2"],
              ["n2", "n1"],
            ],
          ),
        ),
      ).toContain("node 'n1': The graph has a cycle through this node");
      expect(
        messages(
          graph(
            [event("a", "host.offline"), notify("n1"), notify("lost")],
            [["a", "n1"]],
          ),
        ),
      ).toContain("node 'lost': No source reaches this node");
    });

    it("sends a condition down its true and false ports only", ({ expect }) => {
      const condition: AutomationGraphNode = {
        id: "big",
        kind: "condition",
        type: "compare",
        config: { field: "quest_count", operator: "gt", value: 3 },
      };
      const value = graph(
        [
          event("done", "epic.completed"),
          condition,
          notify("yes"),
          notify("no"),
        ],
        [
          ["done", "big"],
          ["big", "yes", "true"],
          ["big", "no", "false"],
        ],
      );
      expect(messages(value)).toEqual([]);
      expect(
        messages({
          ...value,
          edges: [
            ...value.edges.slice(0, 1),
            { from: "big", port: "out", to: "yes" },
          ],
        }),
      ).toContain(
        "node 'big': A condition leaves by its 'true' or 'false' port",
      );
      expect(
        messages(
          graph(
            [
              event("done", "epic.completed"),
              notify("first"),
              condition,
              notify("yes"),
            ],
            [
              ["done", "first"],
              ["first", "big"],
              ["big", "yes", "true"],
            ],
          ),
        ),
      ).toContain(
        "node 'big': A condition never follows an action: every condition is decided before the first effect",
      );
    });
  });

  describe("fields", () => {
    it("lets two sources share one action on the fields they have in common", ({
      expect,
    }) => {
      const shared = graph(
        [
          event("offline", "host.offline"),
          event("online", "host.online"),
          notify(
            "notify",
            "{{project}}: {{host}} since {{since}} {{recipient}}",
          ),
        ],
        [
          ["offline", "notify"],
          ["online", "notify"],
        ],
      );
      expect(messages(shared)).toEqual([]);
      expect(graphs.names(shared, "notify", entries)).toMatchObject({
        host: "text",
        since: "text",
        project: "text",
      });
      expect(graphs.reachingSources(shared, "notify")).toEqual([
        "offline",
        "online",
      ]);
    });

    it("refuses a field one reaching source lacks, naming that source", ({
      expect,
    }) => {
      const value = graph(
        [
          event("offline", "host.offline"),
          event("done", "quest.completed"),
          notify("notify", "{{host}} went down"),
        ],
        [
          ["offline", "notify"],
          ["done", "notify"],
        ],
      );
      const [issue] = graphs.check(value, entries);
      expect(issue).toMatchObject({ node: "notify", source: "done" });
      expect(graphs.message(issue)).toBe(
        "node 'notify': 'host' is not a field of source 'done' (quest.completed): a node sees only the fields every source reaching it provides, so give that source its own action",
      );
    });

    it("refuses a field of another event, and leaves a shared variable to the catalogue", ({
      expect,
    }) => {
      expect(
        messages(
          graph(
            [event("offline", "host.offline"), notify("n", "{{release_tag}}")],
            [["offline", "n"]],
          ),
        ),
      ).toEqual(["node 'n': 'release_tag' is not a field this node may use"]);
      expect(
        messages(
          graph(
            [event("offline", "host.offline"), notify("n", "{{oncall_room}}")],
            [["offline", "n"]],
          ),
        ),
      ).toEqual([]);
    });

    it("types a condition's field against its sources", ({ expect }) => {
      const value = (field: string, operator = "gt") =>
        graph(
          [
            event("done", "epic.completed"),
            {
              id: "c",
              kind: "condition",
              type: "compare",
              config: { field, operator, value: 1 },
            },
            notify("n"),
          ],
          [
            ["done", "c"],
            ["c", "n", "true"],
          ],
        );
      expect(messages(value("quest_count"))).toEqual([]);
      expect(messages(value("host"))).toEqual([
        "node 'c': 'host' is not a field this node may use",
      ]);
      expect(messages(value("title"))).toEqual([
        "node 'c': the comparison 'gt' needs a numeric field, and 'title' is text",
      ]);
    });

    it("lets a second provider add names a node may use", ({ expect }) => {
      const provided = new AutomationGraph().provide(
        (input): Record<string, AutomationSlotKind> =>
          input.node.id === "n" ? { created_quest_id: "number" } : {},
      );
      const value = graph(
        [event("offline", "host.offline"), notify("n", "{{created_quest_id}}")],
        [["offline", "n"]],
      );
      expect(provided.names(value, "n", entries)).toMatchObject({
        host: "text",
        created_quest_id: "number",
      });
    });
  });

  describe("the runner's bounds", () => {
    it("refuses a sixth action under one source, both ports counted", ({
      expect,
    }) => {
      const condition: AutomationGraphNode = {
        id: "c",
        kind: "condition",
        type: "compare",
        config: { field: "quest_count", operator: "gt", value: 1 },
      };
      const actions = Array.from({ length: 6 }, (_, index) =>
        notify(`n${index}`),
      );
      const value = graph(
        [event("done", "epic.completed"), condition, ...actions],
        [
          ["done", "c"],
          ...actions.map((action, index): [string, string, string] => [
            "c",
            action.id,
            index % 2 ? "true" : "false",
          ]),
        ],
      );
      const [issue] = graphs.check(value, entries);
      expect(issue).toMatchObject({ node: "done", source: "done" });
      expect(issue.message).toContain("at most 5 actions");
    });

    it("holds one crossesAbove, after a scalar read only", ({ expect }) => {
      const crossing = (id: string): AutomationGraphNode => ({
        id,
        kind: "condition",
        type: "compare",
        config: { field: "value", operator: "crossesAbove", value: 80 },
      });
      const schedule: AutomationGraphNode = {
        id: "daily",
        kind: "source",
        type: "schedule",
        config: { cron: "0 9 * * *" },
      };
      const read: AutomationGraphNode = {
        id: "read",
        kind: "read",
        type: "quality.coverage",
        config: { filters: {} },
      };
      expect(
        messages(
          graph(
            [schedule, read, crossing("c1"), notify("n", "{{value}}")],
            [
              ["daily", "read"],
              ["read", "c1"],
              ["c1", "n", "true"],
            ],
          ),
        ),
      ).toEqual([]);
      expect(
        messages(
          graph(
            [schedule, read, crossing("c1"), crossing("c2"), notify("n")],
            [
              ["daily", "read"],
              ["read", "c1"],
              ["c1", "c2", "true"],
              ["c2", "n", "true"],
            ],
          ),
        ),
      ).toContain(
        "node 'c2': An automation holds at most one 'crosses above' condition: its baseline is one per automation",
      );
      expect(
        messages(
          graph(
            [
              event("done", "epic.completed"),
              {
                ...crossing("c1"),
                config: {
                  field: "quest_count",
                  operator: "crossesAbove",
                  value: 3,
                },
              },
              notify("n"),
            ],
            [
              ["done", "c1"],
              ["c1", "n", "true"],
            ],
          ),
        ),
      ).toContain(
        "node 'c1': the comparison 'crossesAbove' follows a scalar read that supports it",
      );
    });

    it("notifies the release roster only under release.published", ({
      expect,
    }) => {
      const roster = notify("n", "{{project}}", {
        recipient: undefined,
        audience: "projectMembersExceptPublisher",
        category: "releases",
      });
      delete (roster.config as Record<string, unknown>).recipient;
      expect(
        messages(
          graph(
            [event("published", "release.published"), roster],
            [["published", "n"]],
          ),
        ),
      ).toEqual([]);
      const [issue] = graphs.check(
        graph(
          [
            event("published", "release.published"),
            event("done", "epic.completed"),
            roster,
          ],
          [
            ["published", "n"],
            ["done", "n"],
          ],
        ),
        entries,
      );
      expect(issue).toMatchObject({ node: "n", source: "done" });
      expect(issue.message).toContain("'release.published' only");
    });
  });

  describe("walking", () => {
    it("orders a source's nodes deterministically and cuts its subgraph", ({
      expect,
    }) => {
      const value = graph(
        [
          event("b-source", "host.offline"),
          event("a-source", "host.online"),
          { ...notify("z"), position: { x: 1, y: 2 } },
          notify("y"),
          notify("x"),
        ],
        [
          ["b-source", "z"],
          ["b-source", "y"],
          ["y", "x"],
          ["a-source", "x"],
        ],
      );
      expect(graphs.order(value, "b-source")).toEqual([
        "b-source",
        "y",
        "x",
        "z",
      ]);
      expect(graphs.order(value)).toEqual([
        "a-source",
        "b-source",
        "y",
        "x",
        "z",
      ]);
      const sub = graphs.subgraph(value, "b-source");
      expect(sub.nodes.map((node) => node.id)).toEqual([
        "b-source",
        "z",
        "y",
        "x",
      ]);
      expect(sub.nodes.find((node) => node.id === "z")?.position).toBe(
        undefined,
      );
      expect(sub.edges).toHaveLength(3);
    });
  });

  describe("outputs", () => {
    const create: AutomationGraphNode = {
      id: "create",
      kind: "action",
      type: "createQuest",
      config: { title: "{{title}}", description: "", area: "ops" },
    };
    const tag = (id = "tag"): AutomationGraphNode => ({
      id,
      kind: "action",
      type: "addTag",
      config: { quest: "{{created_quest_id}}", tag: "follow-up" },
    });

    it("declares flat names that collide with no source field", ({
      expect,
    }) => {
      const vocabulary = new AutomationVocabulary();
      const fields = new Set(
        vocabulary.all().flatMap((entry) => Object.keys(entry.fields)),
      );
      const outputs = vocabulary
        .all()
        .flatMap((entry) => Object.keys(entry.outputs ?? {}));
      expect(outputs.sort()).toEqual([
        "appended_folio_id",
        "created_quest_id",
        "created_quest_number",
      ]);
      expect(outputs.filter((name) => fields.has(name))).toEqual([]);
      expect(vocabulary.reservedNames().has("created_quest_id")).toBe(true);
    });

    it("gives an action the outputs of a producer on every path to it", ({
      expect,
    }) => {
      const value = graph(
        [event("done", "epic.completed"), create, tag()],
        [
          ["done", "create"],
          ["create", "tag"],
        ],
      );
      expect(messages(value)).toEqual([]);
      expect(graphs.outputs(value, "tag", entries)).toEqual({
        created_quest_id: {
          kind: "number",
          from: "quest_id",
          producer: "create",
        },
        created_quest_number: {
          kind: "number",
          from: "shortId",
          producer: "create",
        },
      });
      expect(graphs.outputs(value, "create", entries)).toEqual({});
    });

    it("refuses an output whose producer a path goes around", ({ expect }) => {
      const value = graph(
        [event("done", "epic.completed"), create, tag()],
        [
          ["done", "create"],
          ["create", "tag"],
          ["done", "tag"],
        ],
      );
      expect(messages(value)).toEqual([
        "node 'tag': 'created_quest_id' comes from 'create', which is not on every path to this node: an output reaches only the actions every path passes it on the way to",
      ]);
      const twoSources = graph(
        [
          event("done", "epic.completed"),
          event("other", "epic.completed"),
          create,
          tag(),
        ],
        [
          ["done", "create"],
          ["create", "tag"],
          ["other", "tag"],
        ],
      );
      expect(messages(twoSources)).toHaveLength(1);
    });

    it("refuses two producers of one name upstream of a node, naming both", ({
      expect,
    }) => {
      const value = graph(
        [
          event("done", "epic.completed"),
          create,
          { ...create, id: "create-again" },
          tag(),
        ],
        [
          ["done", "create"],
          ["create", "create-again"],
          ["create-again", "tag"],
        ],
      );
      expect(messages(value)).toContain(
        "node 'tag': 'created_quest_id' is produced twice upstream of this node, by 'create' and 'create-again': keep one",
      );
    });
  });

  describe("a run's walk", () => {
    const condition: AutomationGraphNode = {
      id: "big",
      kind: "condition",
      type: "compare",
      config: { field: "quest_count", operator: "gt", value: 3 },
    };
    const branching = graph(
      [
        event("done", "epic.completed"),
        event("done-too", "epic.completed"),
        condition,
        notify("yes"),
        {
          id: "tag",
          kind: "action",
          type: "addTag",
          config: { quest: 1, tag: "x" },
        },
        notify("no"),
      ],
      [
        ["done", "big"],
        ["done-too", "yes"],
        ["big", "yes", "true"],
        ["big", "tag", "true"],
        ["big", "no", "false"],
      ],
    );

    it("follows the port a condition takes, and fans out from it", ({
      expect,
    }) => {
      const taken = graphs.walk(branching, "done", () => "true");
      expect([...taken.reached].sort()).toEqual(["big", "done", "tag", "yes"]);
      expect(taken.decisions).toEqual([{ node: "big", port: "true" }]);
      const other = graphs.walk(branching, "done", () => "false");
      expect([...other.reached].sort()).toEqual(["big", "done", "no"]);
      const none = graphs.walk(branching, "done", () => undefined);
      expect([...none.reached]).toEqual(["done", "big"]);
      expect(none.decisions).toEqual([{ node: "big" }]);
    });

    it("walks each source of one event on its own", ({ expect }) => {
      expect(graphs.steps(branching, "done").map((step) => step.node)).toEqual([
        "no",
        "no",
        "tag",
        "yes",
        "yes",
      ]);
      expect(
        graphs.steps(branching, "done-too").map((step) => step.node),
      ).toEqual(["yes", "yes"]);
      const walk = graphs.walk(branching, "done-too", () => "false");
      expect([...walk.reached]).toEqual(["done-too", "yes"]);
      expect(graphs.subgraph(branching, "done-too").nodes).toHaveLength(2);
    });

    it("expands a notification into one step per channel, and names the stopped branch", ({
      expect,
    }) => {
      expect(graphs.steps(branching, "done").slice(0, 2)).toEqual([
        { node: "no", channel: "inbox" },
        { node: "no", channel: "email" },
      ]);
      expect(
        graphs.action(branching, { node: "no", channel: "email" }),
      ).toMatchObject({ kind: "notify", channel: "email" });
      expect(
        (
          graphs.action(branching, {
            node: "no",
            channel: "email",
          }) as never as {
            channels?: string[];
          }
        ).channels,
      ).toBe(undefined);
      expect([...graphs.downstream(branching, "big")].sort()).toEqual([
        "no",
        "tag",
        "yes",
      ]);
      expect([...graphs.downstream(branching, "tag")]).toEqual([]);
    });
  });

  describe("fromV1", () => {
    it("turns a v1 rule into a straight line with fixed ids", ({ expect }) => {
      const value = AutomationGraph.fromV1({
        version: 1,
        trigger: { kind: "event", event: "epic.completed" },
        select: null,
        guard: { field: "quest_count", operator: "gt", value: 2 },
        actions: [
          {
            kind: "notify",
            recipient: "{{recipient}}",
            channels: ["inbox"],
            title: "Done",
            text: "{{project}}",
            category: "automations",
          },
          { kind: "addTag", quest: "{{shortId}}", tag: "done" },
        ],
      });
      expect(value.nodes.map((node) => node.id)).toEqual([
        "source",
        "condition",
        "action-1",
        "action-2",
      ]);
      expect(value.edges).toEqual([
        { from: "source", port: "out", to: "condition" },
        { from: "condition", port: "true", to: "action-1" },
        { from: "action-1", port: "out", to: "action-2" },
      ]);
      expect(messages(value)).toEqual([]);
    });
  });
});
