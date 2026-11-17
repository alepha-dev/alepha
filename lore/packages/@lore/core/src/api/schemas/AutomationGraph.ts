import { AlephaError } from "alepha";

import type { AutomationDescriptor } from "./automationDescriptorSchema.ts";
import type { AutomationGraphEdge } from "./automationGraphEdgeSchema.ts";
import type { AutomationGraphNode } from "./automationGraphNodeSchema.ts";
import {
  automationGraphSchema,
  type AutomationGraphValue,
} from "./automationGraphSchema.ts";
import type { AutomationRule } from "./automationRuleSchema.ts";
import type { AutomationSlotKind } from "./automationSlotKindSchema.ts";
import { AutomationTemplateTokens } from "./AutomationTemplateTokens.ts";
import { AutomationVocabulary } from "./AutomationVocabulary.ts";

/**
 * What an automation graph means (#E155, #Q3803), browser-safe like
 * {@link AutomationVocabulary}: the structure (sources, wires, acyclicity,
 * reachability), the fields each node may use, and the bounds the runner
 * relies on. Every issue names the node it is about, and the source when a
 * source is the reason.
 *
 * It takes the catalogue's entries as an argument rather than reading them:
 * the server passes `AutomationCatalog.entries()`, the browser the entries
 * of the catalogue it fetched. Availability (a permission, a capability) and
 * the slots of each node are the catalogue's server-side checks, which run
 * per node with {@link names} as the fields a node may use.
 */
export class AutomationGraph {
  public static readonly MAX_NODES = 40;
  public static readonly MAX_SOURCES = 8;
  /**
   * Action nodes reachable from one source, both ports of a condition
   * counted: a run's frozen plan has to fit its snapshot (250 steps, 64 KiB),
   * which is what bounded a v1 rule to five actions.
   */
  public static readonly MAX_ACTIONS_PER_SOURCE = 5;

  protected readonly tokens = new AutomationTemplateTokens();
  protected readonly providers: AutomationGraphNameProvider[] = [
    (input) => this.sourceFields(input),
  ];

  /**
   * Add a provider of names a node may use, beside the fields of its
   * sources: what upstream actions produce is one (#Q3814).
   */
  public provide(provider: AutomationGraphNameProvider): this {
    this.providers.push(provider);
    return this;
  }

  public node(
    graph: AutomationGraphValue,
    id: string,
  ): AutomationGraphNode | undefined {
    return graph.nodes.find((node) => node.id === id);
  }

  public sources(graph: AutomationGraphValue): AutomationGraphNode[] {
    return graph.nodes.filter((node) => node.kind === "source");
  }

  public outgoing(
    graph: AutomationGraphValue,
    id: string,
    port?: AutomationGraphEdge["port"],
  ): AutomationGraphEdge[] {
    return graph.edges.filter(
      (edge) => edge.from === id && (port === undefined || edge.port === port),
    );
  }

  public incoming(
    graph: AutomationGraphValue,
    id: string,
  ): AutomationGraphEdge[] {
    return graph.edges.filter((edge) => edge.to === id);
  }

  /**
   * Every node reachable from `from`, `from` included, whatever a condition
   * decides.
   */
  public reachable(graph: AutomationGraphValue, from: string): Set<string> {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const edge of this.outgoing(graph, id)) stack.push(edge.to);
    }
    return seen;
  }

  /**
   * The ids of the sources that reach a node, sorted.
   */
  public reachingSources(graph: AutomationGraphValue, id: string): string[] {
    return this.sources(graph)
      .filter((source) => this.reachable(graph, source.id).has(id))
      .map((source) => source.id)
      .sort();
  }

  /**
   * A deterministic topological order of the nodes reachable from `from`
   * (every node when absent), ties broken by node id. A cycle leaves its
   * nodes out, which {@link check} refuses.
   */
  public order(graph: AutomationGraphValue, from?: string): string[] {
    const scope = from
      ? this.reachable(graph, from)
      : new Set(graph.nodes.map((node) => node.id));
    const degree = new Map<string, number>(
      [...scope].map((id) => [id, 0] as const),
    );
    for (const edge of graph.edges)
      if (scope.has(edge.from) && scope.has(edge.to))
        degree.set(edge.to, degree.get(edge.to)! + 1);
    const ready = [...scope].filter((id) => degree.get(id) === 0).sort();
    const order: string[] = [];
    while (ready.length) {
      const id = ready.shift()!;
      order.push(id);
      const next: string[] = [];
      for (const edge of this.outgoing(graph, id)) {
        if (!scope.has(edge.to)) continue;
        const left = degree.get(edge.to)! - 1;
        degree.set(edge.to, left);
        if (left === 0) next.push(edge.to);
      }
      ready.push(...next);
      ready.sort();
    }
    return order;
  }

  /**
   * What a run from one source can walk: that source and what it reaches,
   * positions stripped. A run's snapshot holds this, not the whole graph.
   */
  public subgraph(
    graph: AutomationGraphValue,
    sourceId: string,
  ): AutomationGraphValue {
    const scope = this.reachable(graph, sourceId);
    return {
      version: 2,
      nodes: graph.nodes
        .filter((node) => scope.has(node.id))
        .map(({ position: _position, ...node }) => node),
      edges: graph.edges.filter(
        (edge) => scope.has(edge.from) && scope.has(edge.to),
      ),
    };
  }

  /**
   * The names a node may use in its templates and its comparison: what
   * every provider gives it. The first provider is the intersection of the
   * fields of every source that reaches it; a source and a read use
   * variables only, as the trigger and the selection of a v1 rule did.
   */
  public names(
    graph: AutomationGraphValue,
    id: string,
    entries: readonly AutomationDescriptor[],
  ): Record<string, AutomationSlotKind> {
    const node = this.node(graph, id);
    if (!node) return {};
    const describe = this.describer(entries);
    const sources = this.reachingSources(graph, id);
    const names: Record<string, AutomationSlotKind> = {};
    for (const provider of this.providers)
      Object.assign(names, provider({ graph, node, sources, describe }));
    return names;
  }

  /**
   * The fields one source brings to the nodes after it: an event's own, or
   * what a schedule's read selects.
   */
  public fieldsOf(
    graph: AutomationGraphValue,
    sourceId: string,
    entries: readonly AutomationDescriptor[],
  ): Record<string, AutomationSlotKind> {
    return this.pathFields(graph, sourceId, this.describer(entries));
  }

  /**
   * Every issue the graph holds, in a stable order. Empty means valid as a
   * graph; the catalogue still checks each node's slots and availability.
   */
  public check(
    input: unknown,
    entries: readonly AutomationDescriptor[],
  ): AutomationGraphIssue[] {
    const parsed = automationGraphSchema.safeParse(input);
    if (!parsed.success)
      return parsed.error.issues.map((issue) => ({
        message: issue.path.length
          ? `${issue.path.join(".")}: ${issue.message}`
          : issue.message,
      }));
    const graph = parsed.data;
    const describe = this.describer(entries);
    const issues: AutomationGraphIssue[] = [];
    const add = (issue: AutomationGraphIssue) => issues.push(issue);

    const sources = this.sources(graph);
    if (sources.length === 0) add({ message: "A graph needs a source" });
    if (sources.length > AutomationGraph.MAX_SOURCES)
      add({
        message: `A graph holds at most ${AutomationGraph.MAX_SOURCES} sources`,
      });
    const schedule = sources.find(
      (node) => node.type === AutomationVocabulary.SCHEDULE,
    );
    if (schedule && sources.length > 1)
      add({
        node: schedule.id,
        message:
          "A schedule is the only source of its automation: give the other sources an automation of their own",
      });

    for (const node of graph.nodes) this.checkType(node, describe, add);
    if (issues.length) return issues;
    this.checkEdges(graph, add);
    if (issues.length) return issues;

    if (this.order(graph).length !== graph.nodes.length) {
      const order = new Set(this.order(graph));
      const node = graph.nodes.find((item) => !order.has(item.id))!;
      add({
        node: node.id,
        message: "The graph has a cycle through this node",
      });
      return issues;
    }
    const reached = new Set(
      sources.flatMap((source) => [...this.reachable(graph, source.id)]),
    );
    for (const node of graph.nodes)
      if (node.kind !== "source" && !reached.has(node.id))
        add({ node: node.id, message: "No source reaches this node" });
    for (const node of graph.nodes)
      if (
        (node.kind === "read" || node.kind === "condition") &&
        this.outgoing(graph, node.id).length === 0
      )
        add({ node: node.id, message: "This node leads nowhere" });

    for (const source of sources) {
      const actions = [...this.reachable(graph, source.id)].filter(
        (id) => this.node(graph, id)?.kind === "action",
      );
      if (actions.length === 0)
        add({
          node: source.id,
          source: source.id,
          message: "This source reaches no action",
        });
      if (actions.length > AutomationGraph.MAX_ACTIONS_PER_SOURCE)
        add({
          node: source.id,
          source: source.id,
          message: `A source reaches at most ${AutomationGraph.MAX_ACTIONS_PER_SOURCE} actions, both ports of a condition counted; this one reaches ${actions.length}`,
        });
    }
    if (issues.length) return issues;

    const crossings = graph.nodes.filter(
      (node) =>
        node.kind === "condition" && node.config.operator === "crossesAbove",
    );
    if (crossings.length > 1)
      add({
        node: crossings[1].id,
        message:
          "An automation holds at most one 'crosses above' condition: its baseline is one per automation",
      });
    for (const node of graph.nodes) {
      if (node.kind === "condition")
        this.checkCondition(graph, node, entries, describe, add);
      if (node.kind === "action")
        this.checkAction(graph, node, entries, describe, add);
    }
    return issues;
  }

  /**
   * {@link check}, throwing the first issue, prefixed with its node.
   */
  public assert(
    input: unknown,
    entries: readonly AutomationDescriptor[],
  ): AutomationGraphValue {
    const [issue] = this.check(input, entries);
    if (issue) throw new AlephaError(this.message(issue));
    return automationGraphSchema.parse(input);
  }

  public message(issue: AutomationGraphIssue): string {
    return issue.node && !issue.message.startsWith(`node '${issue.node}'`)
      ? `node '${issue.node}': ${issue.message}`
      : issue.message;
  }

  /**
   * A stored rule as a graph. A graph is itself; a v1 rule is read through
   * {@link fromV1}, which is how the runner walks graphs while storage
   * still holds v1 rules (#Q3804).
   */
  public static of(
    rule: AutomationRule | AutomationGraphValue,
  ): AutomationGraphValue {
    return rule.version === 2 ? rule : AutomationGraph.fromV1(rule);
  }

  /**
   * The source a run starts at: the one named, or the first of the graph,
   * which is the only one of a run's subgraph.
   */
  public source(graph: AutomationGraphValue, id?: string): AutomationGraphNode {
    const source = id
      ? this.node(graph, id)
      : graph.nodes.find((node) => node.kind === "source");
    if (!source || source.kind !== "source")
      throw new AlephaError(
        id ? `'${id}' is not a source of this automation` : "No source",
      );
    return source;
  }

  /**
   * The read a schedule source is followed by.
   */
  public read(
    graph: AutomationGraphValue,
    sourceId?: string,
  ): AutomationGraphNode | undefined {
    return this.readOf(graph, this.source(graph, sourceId).id);
  }

  /**
   * The vocabulary entry whose fields a run's contexts carry: the event, or
   * what a schedule reads.
   */
  public sourceKey(graph: AutomationGraphValue, sourceId?: string): string {
    const source = this.source(graph, sourceId);
    return source.type === AutomationVocabulary.SCHEDULE
      ? (this.readOf(graph, source.id)?.type ?? source.type)
      : source.type;
  }

  public conditions(graph: AutomationGraphValue): AutomationGraphNode[] {
    return graph.nodes.filter((node) => node.kind === "condition");
  }

  /**
   * The steps a run from a source can take, in walk order: one per action
   * node, and one per channel for a notification (#Q3613).
   */
  public steps(
    graph: AutomationGraphValue,
    sourceId?: string,
  ): AutomationGraphStep[] {
    const source = this.source(graph, sourceId);
    return this.order(graph, source.id).flatMap((id) => {
      const node = this.node(graph, id)!;
      if (node.kind !== "action") return [];
      if (node.type !== "notify") return [{ node: id }];
      const config = node.config as { channels?: string[] };
      // A notification naming one `channel` (the form before #Q3613) is
      // one step; a list of channels is one step per channel.
      if (!config.channels) return [{ node: id }];
      return config.channels.map((channel) => ({ node: id, channel }));
    });
  }

  /**
   * A step's action, as the adapters take it: the node's type as its kind,
   * and for a notification the one channel of the step.
   */
  public action(
    graph: AutomationGraphValue,
    step: AutomationGraphStep,
  ): AutomationRule["actions"][number] {
    const node = this.node(graph, step.node);
    if (!node || node.kind !== "action")
      throw new AlephaError(`Step '${step.node}' is not an action of this run`);
    const {
      channels: _channels,
      channel: _channel,
      ...rest
    } = node.config as Record<string, unknown>;
    return (
      node.type === "notify"
        ? {
            kind: "notify",
            ...rest,
            channel:
              step.channel ?? (node.config as { channel?: string }).channel,
          }
        : { kind: node.type, ...node.config }
    ) as AutomationRule["actions"][number];
  }

  public sameStep(
    left: AutomationGraphStep & { row?: number },
    right: AutomationGraphStep & { row?: number },
  ): boolean {
    return (
      left.node === right.node &&
      left.channel === right.channel &&
      left.row === right.row
    );
  }

  /**
   * The nodes after a node, the node itself excluded.
   */
  public downstream(graph: AutomationGraphValue, id: string): Set<string> {
    const after = this.reachable(graph, id);
    after.delete(id);
    return after;
  }

  /**
   * One walk from a source: a condition sends it down the port `decide`
   * answers, or down neither when it answers nothing (no data). Every
   * condition is decided before the first effect, so the walk is a plan.
   */
  public walk(
    graph: AutomationGraphValue,
    sourceId: string,
    decide: (node: AutomationGraphNode) => "true" | "false" | undefined,
  ): {
    reached: Set<string>;
    decisions: Array<{ node: string; port?: "true" | "false" }>;
  } {
    const reached = new Set([sourceId]);
    const ports = new Map<string, "true" | "false" | undefined>();
    const decisions: Array<{ node: string; port?: "true" | "false" }> = [];
    for (const id of this.order(graph, sourceId)) {
      if (id === sourceId) continue;
      const node = this.node(graph, id)!;
      const way = this.incoming(graph, id).some(
        (edge) =>
          reached.has(edge.from) &&
          (this.node(graph, edge.from)?.kind === "condition"
            ? ports.get(edge.from) === edge.port
            : true),
      );
      if (!way) continue;
      reached.add(id);
      if (node.kind === "condition") {
        const port = decide(node);
        ports.set(id, port);
        decisions.push({ node: id, ...(port ? { port } : {}) });
      }
    }
    return { reached, decisions };
  }

  /**
   * A v1 rule as a straight-line graph: its source, its read, its guard,
   * then its actions in order, each wired to the next, so a failure still
   * stops everything after it. Node ids are fixed: `source`, `read`,
   * `condition`, `action-1` ... Read by the runner while storage holds v1
   * rules, deleted with them (#Q3805).
   */
  public static fromV1(rule: AutomationRule): AutomationGraphValue {
    const nodes: AutomationGraphNode[] = [];
    const edges: AutomationGraphEdge[] = [];
    const { trigger } = rule;
    nodes.push(
      trigger.kind === "event"
        ? {
            id: "source",
            kind: "source",
            type: trigger.event,
            config: {
              ...(trigger.app !== undefined ? { app: trigger.app } : {}),
              ...(trigger.monitor !== undefined
                ? { monitor: trigger.monitor }
                : {}),
              ...(trigger.host !== undefined ? { host: trigger.host } : {}),
            },
          }
        : {
            id: "source",
            kind: "source",
            type: AutomationVocabulary.SCHEDULE,
            config: { cron: trigger.cron },
          },
    );
    let last = { id: "source", port: "out" as AutomationGraphEdge["port"] };
    const wire = (id: string, port: AutomationGraphEdge["port"] = "out") => {
      edges.push({ from: last.id, port: last.port, to: id });
      last = { id, port };
    };
    if (rule.select) {
      nodes.push({
        id: "read",
        kind: "read",
        type: rule.select.key,
        config: { filters: rule.select.filters },
      });
      wire("read");
    }
    if (rule.guard) {
      nodes.push({
        id: "condition",
        kind: "condition",
        type: AutomationVocabulary.COMPARE,
        config: { ...rule.guard },
      });
      wire("condition", "true");
    }
    for (const [index, action] of rule.actions.entries()) {
      const { kind, ...config } = action;
      const id = `action-${index + 1}`;
      nodes.push({ id, kind: "action", type: kind, config });
      wire(id);
    }
    return { version: 2, nodes, edges };
  }

  protected describer(
    entries: readonly AutomationDescriptor[],
  ): (type: string) => AutomationDescriptor | undefined {
    const map = new Map(entries.map((entry) => [entry.key, entry]));
    return (type) => map.get(type);
  }

  protected checkType(
    node: AutomationGraphNode,
    describe: (type: string) => AutomationDescriptor | undefined,
    add: (issue: AutomationGraphIssue) => void,
  ): void {
    if (
      node.kind === "condition" ||
      (node.kind === "source" && node.type === AutomationVocabulary.SCHEDULE)
    )
      return;
    const entry = describe(node.type);
    const expected: AutomationDescriptor["type"][] =
      node.kind === "source"
        ? ["event"]
        : node.kind === "read"
          ? ["selection", "metric"]
          : ["action"];
    if (!entry || !expected.includes(entry.type))
      add({
        node: node.id,
        message: `unknown or unsupported ${node.kind} type '${node.type}'`,
      });
  }

  protected checkEdges(
    graph: AutomationGraphValue,
    add: (issue: AutomationGraphIssue) => void,
  ): void {
    for (const edge of graph.edges) {
      const from = this.node(graph, edge.from);
      const to = this.node(graph, edge.to);
      if (!from || !to) {
        add({
          ...(from ? { node: from.id } : {}),
          message: `The wire ${edge.from}.${edge.port} -> ${edge.to} names a node the graph does not hold`,
        });
        continue;
      }
      const refuse = (message: string) => add({ node: to.id, message });
      if (from.kind === "condition" ? edge.port === "out" : edge.port !== "out")
        add({
          node: from.id,
          message:
            from.kind === "condition"
              ? "A condition leaves by its 'true' or 'false' port"
              : `Only a condition has a '${edge.port}' port`,
        });
      else if (to.kind === "source")
        refuse("Nothing wires into a source: a source starts a run");
      else if (to.kind === "read") {
        if (
          from.kind !== "source" ||
          from.type !== AutomationVocabulary.SCHEDULE
        )
          refuse("A read follows a schedule, and only a schedule");
      } else if (to.kind === "condition") {
        if (from.kind === "action")
          refuse(
            "A condition never follows an action: every condition is decided before the first effect",
          );
      }
      if (
        from.kind === "source" &&
        from.type === AutomationVocabulary.SCHEDULE &&
        to.kind !== "read"
      )
        add({
          node: from.id,
          message: "A schedule is followed by its read, and nothing else",
        });
      if (
        from.kind === "source" &&
        from.type !== AutomationVocabulary.SCHEDULE &&
        to.kind === "read"
      )
        add({
          node: to.id,
          message:
            "An event brings its own fields: a read follows a schedule only",
        });
    }
    for (const source of this.sources(graph))
      if (
        source.type === AutomationVocabulary.SCHEDULE &&
        this.outgoing(graph, source.id).length !== 1
      )
        add({
          node: source.id,
          message: "A schedule is followed by exactly one read",
        });
    for (const node of graph.nodes)
      if (node.kind === "read" && this.incoming(graph, node.id).length !== 1)
        add({ node: node.id, message: "A read has exactly one way in" });
  }

  protected checkCondition(
    graph: AutomationGraphValue,
    node: AutomationGraphNode,
    entries: readonly AutomationDescriptor[],
    describe: (type: string) => AutomationDescriptor | undefined,
    add: (issue: AutomationGraphIssue) => void,
  ): void {
    const guard = node.config as {
      field: string;
      operator: string;
      value: unknown;
    };
    const names = this.names(graph, node.id, entries);
    const kind = Object.hasOwn(names, guard.field)
      ? names[guard.field]
      : undefined;
    if (!kind) {
      add(this.missing(graph, node, guard.field, describe));
      return;
    }
    if (kind !== "number" && guard.operator !== "eq" && guard.operator !== "ne")
      add({
        node: node.id,
        message: `the comparison '${guard.operator}' needs a numeric field, and '${guard.field}' is ${kind}`,
      });
    if (guard.operator === "delta" || guard.operator === "crossesAbove") {
      const [sourceId] = this.reachingSources(graph, node.id);
      const source = this.node(graph, sourceId);
      const read = source && this.outgoing(graph, source.id)[0];
      const entry = read && describe(this.node(graph, read.to)?.type ?? "");
      if (
        source?.type !== AutomationVocabulary.SCHEDULE ||
        entry?.result !== "scalar" ||
        !entry.operators.includes(guard.operator as never)
      )
        add({
          node: node.id,
          message: `the comparison '${guard.operator}' follows a scalar read that supports it`,
        });
      else if (guard.operator === "delta" && guard.field !== "value")
        add({
          node: node.id,
          message: "'delta' compares the scalar value with its previous day",
        });
    }
    this.checkNames(graph, node, guard.value, names, entries, add);
  }

  protected checkAction(
    graph: AutomationGraphValue,
    node: AutomationGraphNode,
    entries: readonly AutomationDescriptor[],
    describe: (type: string) => AutomationDescriptor | undefined,
    add: (issue: AutomationGraphIssue) => void,
  ): void {
    const names = this.names(graph, node.id, entries);
    this.checkNames(graph, node, node.config, names, entries, add);
    if (node.type !== "notify") return;
    const sources = this.reachingSources(graph, node.id).map((id) =>
      this.node(graph, id)!,
    );
    const config = node.config as { audience?: string; category?: string };
    const notRelease = sources.find(
      (source) => source.type !== "release.published",
    );
    if (config.audience && notRelease)
      add({
        node: node.id,
        source: notRelease.id,
        message: `the project roster is notified on 'release.published' only, and source '${notRelease.id}' is '${notRelease.type}'`,
      });
    if (config.audience && config.category !== "releases")
      add({
        node: node.id,
        message: "the project roster is notified in the releases category",
      });
    if (config.category === "releases" && notRelease)
      add({
        node: node.id,
        source: notRelease.id,
        message: `the releases category needs 'release.published', and source '${notRelease.id}' is '${notRelease.type}'`,
      });
    if (config.category === "reminders") {
      const lacking = sources.find(
        (source) =>
          this.readOf(graph, source.id)?.type !== "quests.remindersDue",
      );
      if (lacking)
        add({
          node: node.id,
          source: lacking.id,
          message: `the reminders category needs the 'quests.remindersDue' read, which source '${lacking.id}' does not have`,
        });
    }
  }

  protected checkNames(
    graph: AutomationGraphValue,
    node: AutomationGraphNode,
    value: unknown,
    names: Record<string, AutomationSlotKind>,
    entries: readonly AutomationDescriptor[],
    add: (issue: AutomationGraphIssue) => void,
  ): void {
    const describe = this.describer(entries);
    let used: string[];
    try {
      used = this.tokens.inValue(value);
    } catch (error) {
      add({
        node: node.id,
        message: error instanceof Error ? error.message : "Invalid placeholder",
      });
      return;
    }
    for (const name of new Set(used))
      if (!Object.hasOwn(names, name)) {
        const issue = this.missing(graph, node, name, describe);
        // A name no source of any kind provides is a shared variable: the
        // catalogue resolves it.
        if (issue.source || this.reserved(entries).has(name)) add(issue);
      }
  }

  /**
   * Why a node may not use a name: the reaching source that lacks it, or
   * that no source provides it.
   */
  protected missing(
    graph: AutomationGraphValue,
    node: AutomationGraphNode,
    name: string,
    describe: (type: string) => AutomationDescriptor | undefined,
  ): AutomationGraphIssue {
    const sources = this.reachingSources(graph, node.id);
    const fields = sources.map((id) => ({
      id,
      fields: this.pathFields(graph, id, describe),
    }));
    const having = fields.filter((item) => Object.hasOwn(item.fields, name));
    if (having.length && having.length < fields.length) {
      const lacking = fields.find((item) => !Object.hasOwn(item.fields, name))!;
      return {
        node: node.id,
        source: lacking.id,
        message: `'${name}' is not a field of source '${lacking.id}' (${this.node(graph, lacking.id)?.type}): a node sees only the fields every source reaching it provides, so give that source its own action`,
      };
    }
    if (having.length) {
      const kinds = [...new Set(having.map((item) => item.fields[name]))];
      return {
        node: node.id,
        source: having[0].id,
        message: `'${name}' has a different type in each source reaching this node (${kinds.join(", ")})`,
      };
    }
    return {
      node: node.id,
      message: `'${name}' is not a field this node may use`,
    };
  }

  /**
   * The names that are a field of some entry, or reserved: such a name is
   * never read as a shared variable.
   */
  protected reserved(entries: readonly AutomationDescriptor[]): Set<string> {
    return new Set([
      ...AutomationVocabulary.RESERVED_KEYS,
      ...entries.flatMap((entry) => Object.keys(entry.fields)),
    ]);
  }

  protected sourceFields(
    input: AutomationGraphNameInput,
  ): Record<string, AutomationSlotKind> {
    if (input.node.kind === "source" || input.node.kind === "read") return {};
    if (input.sources.length === 0) return {};
    const [first, ...rest] = input.sources.map((id) =>
      this.pathFields(input.graph, id, input.describe),
    );
    const names: Record<string, AutomationSlotKind> = {};
    for (const [name, kind] of Object.entries(first))
      if (
        rest.every(
          (fields) => Object.hasOwn(fields, name) && fields[name] === kind,
        )
      )
        names[name] = kind;
    return names;
  }

  protected pathFields(
    graph: AutomationGraphValue,
    sourceId: string,
    describe: (type: string) => AutomationDescriptor | undefined,
  ): Record<string, AutomationSlotKind> {
    const source = this.node(graph, sourceId);
    if (!source) return {};
    const key =
      source.type === AutomationVocabulary.SCHEDULE
        ? this.readOf(graph, sourceId)?.type
        : source.type;
    const entry = key ? describe(key) : undefined;
    return { ...entry?.fields };
  }

  protected readOf(
    graph: AutomationGraphValue,
    sourceId: string,
  ): AutomationGraphNode | undefined {
    return this.outgoing(graph, sourceId)
      .map((edge) => this.node(graph, edge.to))
      .find((node) => node?.kind === "read");
  }
}

/**
 * One step of a run: an action node, and the channel of a notification.
 */
export interface AutomationGraphStep {
  node: string;
  channel?: string;
}

export interface AutomationGraphIssue {
  /**
   * The node the issue is about; absent for the graph as a whole.
   */
  node?: string;
  /**
   * The source that is the reason, when one is.
   */
  source?: string;
  message: string;
}

export interface AutomationGraphNameInput {
  graph: AutomationGraphValue;
  node: AutomationGraphNode;
  /**
   * The ids of the sources that reach the node.
   */
  sources: string[];
  describe: (type: string) => AutomationDescriptor | undefined;
}

export type AutomationGraphNameProvider = (
  input: AutomationGraphNameInput,
) => Record<string, AutomationSlotKind>;
