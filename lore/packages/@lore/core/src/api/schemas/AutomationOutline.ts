import { AlephaError } from "alepha";

import type { AutomationCatalogNodeType } from "./automationCatalogNodeTypeSchema.ts";
import {
  AutomationGraph,
  type AutomationGraphIssue,
} from "./AutomationGraph.ts";
import type { AutomationGraphEdge } from "./automationGraphEdgeSchema.ts";
import type { AutomationGraphNode } from "./automationGraphNodeSchema.ts";
import type { AutomationGraphValue } from "./automationGraphSchema.ts";
import type { AutomationNodeOutcome } from "./automationNodeOutcomeSchema.ts";
import { AutomationVocabulary } from "./AutomationVocabulary.ts";

/**
 * An automation read as an outline (#E156, #Q3846), browser-safe like
 * {@link AutomationGraph}: a list of blocks, each its events (or one
 * schedule and its read), at most one condition, then independent
 * sequences of actions on each side. A projection of the graph, never a
 * second stored form: the draft stays the graph, and every edit here takes
 * a graph and returns one, so undo, redo and save do not change.
 *
 * `read` is total for every graph {@link AutomationGraph.structure} accepts,
 * which the outline rules of #Q3845 make every graph the server stores.
 */
export class AutomationOutline {
  /**
   * Outcomes from the worst: a node's rows fold to the first one present.
   */
  public static readonly SEVERITY: readonly AutomationNodeOutcome["outcome"][] =
    [
      "failed",
      "unknown",
      "refused",
      "pending",
      "ran",
      "skipped",
      "not_reached",
    ];

  /**
   * A new automation's empty draft.
   */
  public static readonly EMPTY: AutomationGraphValue = {
    version: 2,
    nodes: [],
    edges: [],
  };

  protected readonly graphs = new AutomationGraph();

  /**
   * The blocks of a graph, in the order its events run; or why it is not
   * an outline, never a throw: a page shows a notice for it.
   */
  public read(graph: AutomationGraphValue): AutomationOutlineReading {
    const [issue] = this.graphs.structure(graph);
    if (issue)
      return { outline: false, issue, message: this.graphs.message(issue) };
    const rank = this.ranker(graph);
    const groups = new Map<string, AutomationGraphNode[]>();
    for (const source of [...this.graphs.sources(graph)].sort(
      (left, right) => rank(left.id) - rank(right.id),
    )) {
      const targets = this.targets(graph, source.id);
      const key =
        source.type === AutomationVocabulary.SCHEDULE || !targets.length
          ? `\u0000${source.id}`
          : targets.join("\u0000");
      groups.set(key, [...(groups.get(key) ?? []), source]);
    }
    return {
      outline: true,
      blocks: [...groups.values()].map((events) =>
        this.block(graph, events, rank),
      ),
    };
  }

  /**
   * The blocks of a graph the caller knows is an outline (an edit's input).
   */
  public blocks(graph: AutomationGraphValue): AutomationOutlineBlock[] {
    const reading = this.read(graph);
    if (!reading.outline) throw new AlephaError(reading.message);
    return reading.blocks;
  }

  /**
   * The block an event, a read, a condition or an action belongs to.
   */
  public blockOf(
    graph: AutomationGraphValue,
    id: string,
  ): AutomationOutlineBlock {
    const block = this.blocks(graph).find((item) =>
      this.members(item).some((node) => node.id === id),
    );
    if (!block) throw new AlephaError(`'${id}' is in no block`);
    return block;
  }

  /**
   * Every node of a block, events first.
   */
  public members(block: AutomationOutlineBlock): AutomationGraphNode[] {
    return [
      ...block.events,
      ...(block.read ? [block.read] : []),
      ...(block.condition ? [block.condition] : []),
      ...block.sequences.flat(),
      ...block.otherwise.flat(),
    ];
  }

  /**
   * An id for a new node, unique and sorting after every id the graph
   * holds as a plain string: `AutomationGraph.order` breaks ties by string,
   * so a new sequence or block shows, and runs, last.
   */
  public id(graph: AutomationGraphValue, type: string): string {
    const base =
      type
        .split(".")
        .pop()!
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || "node";
    const ids = graph.nodes.map((node) => node.id);
    const max = ids.reduce((left, right) => (right > left ? right : left), "");
    for (let depth = 1; depth < 32; depth++)
      for (const suffix of [
        "",
        "-2",
        "-3",
        "-4",
        "-5",
        "-6",
        "-7",
        "-8",
        "-9",
      ]) {
        const candidate = `${"z".repeat(depth)}-${base}${suffix}`;
        if (candidate > max && !ids.includes(candidate)) return candidate;
      }
    throw new AlephaError("No id is left for a new node");
  }

  /**
   * A new block from its event, empty after it; a schedule comes with its
   * read, and stands alone.
   */
  public addBlock(
    graph: AutomationGraphValue,
    source: AutomationOutlineNew,
    read?: AutomationOutlineNew,
  ): AutomationOutlineEdit {
    const schedule = source.type === AutomationVocabulary.SCHEDULE;
    if (schedule && !read)
      throw new AlephaError("A schedule comes with what it reads");
    if (
      this.graphs
        .sources(graph)
        .some((node) => node.type === AutomationVocabulary.SCHEDULE) ||
      (schedule && this.graphs.sources(graph).length)
    )
      throw new AlephaError("A schedule runs alone: it has no other block");
    const added = this.with(graph, { ...source, kind: "source" });
    if (!read) return added;
    const withRead = this.with(added.graph, { ...read, kind: "read" });
    return {
      graph: this.wire(withRead.graph, {
        from: added.id,
        port: "out",
        to: withRead.id,
      }),
      id: added.id,
    };
  }

  /**
   * A block and every node in it gone.
   */
  public removeBlock(
    graph: AutomationGraphValue,
    id: string,
  ): AutomationGraphValue {
    return this.without(
      graph,
      this.members(this.blockOf(graph, id)).map((node) => node.id),
    );
  }

  /**
   * Another event of a block, wired to what its events lead to.
   */
  public addEvent(
    graph: AutomationGraphValue,
    block: string,
    event: AutomationOutlineNew,
  ): AutomationOutlineEdit {
    const found = this.blockOf(graph, block);
    if (found.read || event.type === AutomationVocabulary.SCHEDULE)
      throw new AlephaError("A schedule runs alone: it has no other event");
    const added = this.with(graph, { ...event, kind: "source" });
    let next = added.graph;
    for (const edge of this.graphs.outgoing(graph, found.events[0].id))
      next = this.wire(next, { from: added.id, port: "out", to: edge.to });
    return { graph: next, id: added.id };
  }

  /**
   * An event gone; the last event of its block takes the block with it.
   */
  public removeEvent(
    graph: AutomationGraphValue,
    id: string,
  ): AutomationGraphValue {
    const block = this.blockOf(graph, id);
    if (block.events.length === 1) return this.removeBlock(graph, id);
    return this.without(graph, [id]);
  }

  /**
   * A block's condition, between its events and its actions: what Then
   * held moves to the condition's `true` side.
   */
  public addCondition(
    graph: AutomationGraphValue,
    block: string,
    condition: AutomationOutlineNew,
  ): AutomationOutlineEdit {
    const found = this.blockOf(graph, block);
    if (found.condition) throw new AlephaError("A block holds one condition");
    const added = this.with(graph, { ...condition, kind: "condition" });
    const heads = this.heads(found).map((node) => node.id);
    let next: AutomationGraphValue = {
      ...added.graph,
      edges: added.graph.edges.filter((edge) => !heads.includes(edge.from)),
    };
    for (const head of heads)
      next = this.wire(next, { from: head, port: "out", to: added.id });
    for (const sequence of found.sequences)
      next = this.wire(next, {
        from: added.id,
        port: "true",
        to: sequence[0].id,
      });
    return { graph: next, id: added.id };
  }

  /**
   * A block's condition gone (#Q3846's pin): its Then side stays, wired
   * straight from the events, and its Otherwise side goes with it. An
   * editor asks before removing a condition whose Otherwise holds actions.
   */
  public removeCondition(
    graph: AutomationGraphValue,
    block: string,
  ): AutomationGraphValue {
    const found = this.blockOf(graph, block);
    if (!found.condition) return graph;
    let next = this.without(graph, [
      found.condition.id,
      ...found.otherwise.flat().map((node) => node.id),
    ]);
    for (const head of this.heads(found))
      for (const sequence of found.sequences)
        next = this.wire(next, {
          from: head.id,
          port: "out",
          to: sequence[0].id,
        });
    return next;
  }

  /**
   * A new sequence of one action on a side of a block: Then (Do, without a
   * condition) or Otherwise, which needs a condition.
   */
  public addAction(
    graph: AutomationGraphValue,
    block: string,
    side: AutomationOutlineSide,
    action: AutomationOutlineNew,
  ): AutomationOutlineEdit {
    const found = this.blockOf(graph, block);
    if (side === "otherwise" && !found.condition)
      throw new AlephaError("Otherwise needs a condition");
    const added = this.with(graph, { ...action, kind: "action" });
    if (found.condition)
      return {
        graph: this.wire(added.graph, {
          from: found.condition.id,
          port: side === "then" ? "true" : "false",
          to: added.id,
        }),
        id: added.id,
      };
    let next = added.graph;
    for (const head of this.heads(found))
      next = this.wire(next, { from: head.id, port: "out", to: added.id });
    return { graph: next, id: added.id };
  }

  /**
   * A step right after an action, in its sequence: what followed the
   * action follows the new step.
   */
  public addStep(
    graph: AutomationGraphValue,
    after: string,
    action: AutomationOutlineNew,
  ): AutomationOutlineEdit {
    if (this.graphs.node(graph, after)?.kind !== "action")
      throw new AlephaError(`'${after}' is not an action`);
    const added = this.with(graph, { ...action, kind: "action" });
    const [following] = this.graphs.outgoing(graph, after);
    let next: AutomationGraphValue = {
      ...added.graph,
      edges: added.graph.edges.filter((edge) => edge.from !== after),
    };
    next = this.wire(next, { from: after, port: "out", to: added.id });
    if (following)
      next = this.wire(next, {
        from: added.id,
        port: "out",
        to: following.to,
      });
    return { graph: next, id: added.id };
  }

  /**
   * An action gone, its sequence closed over it; the last action of a
   * sequence takes the sequence with it.
   */
  public removeAction(
    graph: AutomationGraphValue,
    id: string,
  ): AutomationGraphValue {
    if (this.graphs.node(graph, id)?.kind !== "action")
      throw new AlephaError(`'${id}' is not an action`);
    const incoming = this.graphs.incoming(graph, id);
    const [following] = this.graphs.outgoing(graph, id);
    let next = this.without(graph, [id]);
    if (following)
      for (const edge of incoming)
        next = this.wire(next, {
          from: edge.from,
          port: edge.port,
          to: following.to,
        });
    return next;
  }

  /**
   * A node's configuration replaced.
   */
  public setConfig(
    graph: AutomationGraphValue,
    id: string,
    config: Record<string, unknown>,
  ): AutomationGraphValue {
    return this.update(graph, id, (node) => ({ ...node, config }));
  }

  /**
   * Another type for a node, its configuration reset to the new type's: an
   * action changed in its form, the read a schedule selects.
   */
  public setType(
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
   * A new node's configuration (#Q3848): what its type needs filled, empty
   * or at its default, so the checks name what is left to do.
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
   * An event's own switch (#Q3806), saved with the draft.
   */
  public setEnabled(
    graph: AutomationGraphValue,
    id: string,
    enabled: boolean,
  ): AutomationGraphValue {
    return this.update(graph, id, (node) => {
      if (node.kind !== "source")
        throw new AlephaError("Only an event has its own switch");
      return { ...node, enabled };
    });
  }

  /**
   * Another graph's blocks added after these: a preset added to a draft.
   * Its ids are the caller's to keep apart (a preset's are prefixed).
   */
  public merge(
    graph: AutomationGraphValue,
    addition: AutomationGraphValue,
  ): AutomationGraphValue {
    const taken = new Set(graph.nodes.map((node) => node.id));
    const clash = addition.nodes.find((node) => taken.has(node.id));
    if (clash) throw new AlephaError(`'${clash.id}' is already in the graph`);
    return {
      ...graph,
      nodes: [...graph.nodes, ...addition.nodes],
      edges: [...graph.edges, ...addition.edges],
    };
  }

  /**
   * The prefix a preset's nodes take when added to a graph (#Q3812): its
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
   * Each node's rows folded to one outcome, and the ports a condition
   * took over all of them: what a run's outline paints on each row.
   */
  public fold(outcomes: AutomationNodeOutcome[]): Map<
    string,
    {
      outcome: AutomationNodeOutcome["outcome"];
      ports: NonNullable<AutomationNodeOutcome["port"]>[];
    }
  > {
    const folded = new Map<
      string,
      {
        outcome: AutomationNodeOutcome["outcome"];
        ports: NonNullable<AutomationNodeOutcome["port"]>[];
      }
    >();
    const rank = (outcome: AutomationNodeOutcome["outcome"]) =>
      AutomationOutline.SEVERITY.indexOf(outcome);
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

  protected block(
    graph: AutomationGraphValue,
    events: AutomationGraphNode[],
    rank: (id: string) => number,
  ): AutomationOutlineBlock {
    const [first] = events;
    const read =
      first.type === AutomationVocabulary.SCHEDULE
        ? this.graphs
            .outgoing(graph, first.id)
            .map((edge) => this.graphs.node(graph, edge.to)!)
            .find((node) => node.kind === "read")
        : undefined;
    const next = this.graphs
      .outgoing(graph, (read ?? first).id)
      .map((edge) => this.graphs.node(graph, edge.to)!);
    const condition = next.find((node) => node.kind === "condition");
    const sequences = (starts: string[]) =>
      starts
        .sort((left, right) => rank(left) - rank(right))
        .map((start) => this.sequence(graph, start));
    const port = (name: "true" | "false") =>
      condition
        ? this.graphs.outgoing(graph, condition.id, name).map((edge) => edge.to)
        : [];
    return {
      key: first.id,
      events,
      ...(read ? { read } : {}),
      ...(condition ? { condition } : {}),
      sequences: sequences(
        condition
          ? port("true")
          : next
              .filter((node) => node.kind === "action")
              .map((node) => node.id),
      ),
      otherwise: sequences(port("false")),
    };
  }

  protected sequence(
    graph: AutomationGraphValue,
    start: string,
  ): AutomationGraphNode[] {
    const actions: AutomationGraphNode[] = [];
    let id: string | undefined = start;
    while (id) {
      actions.push(this.graphs.node(graph, id)!);
      id = this.graphs.outgoing(graph, id)[0]?.to;
    }
    return actions;
  }

  /**
   * What a block's first step is wired from: its events, or a schedule's
   * read.
   */
  protected heads(block: AutomationOutlineBlock): AutomationGraphNode[] {
    return block.read ? [block.read] : block.events;
  }

  protected targets(graph: AutomationGraphValue, id: string): string[] {
    return [
      ...new Set(this.graphs.outgoing(graph, id).map((edge) => edge.to)),
    ].sort();
  }

  protected ranker(graph: AutomationGraphValue): (id: string) => number {
    const order = new Map(
      this.graphs.order(graph).map((id, index) => [id, index] as const),
    );
    return (id) => order.get(id) ?? Number.MAX_SAFE_INTEGER;
  }

  protected with(
    graph: AutomationGraphValue,
    node: AutomationOutlineNew & { kind: AutomationGraphNode["kind"] },
  ): AutomationOutlineEdit {
    const id = this.id(graph, node.type);
    const { position: _position, ...rest } = node as AutomationGraphNode;
    return {
      graph: { ...graph, nodes: [...graph.nodes, { ...rest, id }] },
      id,
    };
  }

  protected wire(
    graph: AutomationGraphValue,
    edge: AutomationGraphEdge,
  ): AutomationGraphValue {
    if (
      graph.edges.some(
        (item) =>
          item.from === edge.from &&
          item.port === edge.port &&
          item.to === edge.to,
      )
    )
      return graph;
    return { ...graph, edges: [...graph.edges, edge] };
  }

  protected without(
    graph: AutomationGraphValue,
    ids: string[],
  ): AutomationGraphValue {
    const gone = new Set(ids);
    return {
      ...graph,
      nodes: graph.nodes.filter((node) => !gone.has(node.id)),
      edges: graph.edges.filter(
        (edge) => !gone.has(edge.from) && !gone.has(edge.to),
      ),
    };
  }

  protected update(
    graph: AutomationGraphValue,
    id: string,
    change: (node: AutomationGraphNode) => AutomationGraphNode,
  ): AutomationGraphValue {
    if (!this.graphs.node(graph, id))
      throw new AlephaError(`'${id}' is not in the graph`);
    return {
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === id ? change(node) : node)),
    };
  }
}

/**
 * One block: its events (one schedule and its read, or 1 to 8 events that
 * share everything after them), at most one condition, and the sequences
 * of actions on each side. `key` is its first event's id.
 */
export interface AutomationOutlineBlock {
  key: string;
  events: AutomationGraphNode[];
  read?: AutomationGraphNode;
  condition?: AutomationGraphNode;
  /**
   * The condition's `true` side, or straight from the events: each
   * sequence its actions, each wired to the next.
   */
  sequences: AutomationGraphNode[][];
  /**
   * The condition's `false` side.
   */
  otherwise: AutomationGraphNode[][];
}

export type AutomationOutlineSide = "then" | "otherwise";

export type AutomationOutlineReading =
  | { outline: true; blocks: AutomationOutlineBlock[] }
  | { outline: false; issue: AutomationGraphIssue; message: string };

/**
 * A node an edit adds: its id is the outline's to choose.
 */
export interface AutomationOutlineNew {
  type: string;
  config: Record<string, unknown>;
  enabled?: boolean;
}

export interface AutomationOutlineEdit {
  graph: AutomationGraphValue;
  /**
   * The id of the node the edit added.
   */
  id: string;
}
