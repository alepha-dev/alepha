import { $inject } from "alepha";

import type { Automation } from "../entities/automations.ts";
import { AutomationDependencyError } from "../errors/AutomationDependencyError.ts";
import { AutomationGraph } from "../schemas/AutomationGraph.ts";
import type { AutomationSourceHealth } from "../schemas/automationSourceHealthSchema.ts";
import { AutomationVocabulary } from "../schemas/AutomationVocabulary.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationChannels } from "./AutomationChannels.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationProjectSecurity } from "./AutomationProjectSecurity.ts";

/**
 * Dependency loss is reversible. Permission and resource validation remain
 * separate, so restoring a capability cannot clear a security review.
 */
export class AutomationDependencies {
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly channels = $inject(AutomationChannels);
  protected readonly security = $inject(AutomationProjectSecurity);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly graphs = $inject(AutomationGraph);

  /**
   * The automation as a whole: refused only when no enabled source can run
   * (#Q3806). A source losing what it needs breaks that source, and the
   * others keep running.
   */
  public async assert(rule: Automation): Promise<void> {
    const sources = await this.sources(rule);
    const enabled = this.graphs
      .sources(rule.rule)
      .filter((node) => node.enabled !== false);
    const broken = enabled.filter(
      (node) => sources[node.id]?.health === "broken",
    );
    if (enabled.length && broken.length === enabled.length)
      throw new AutomationDependencyError(
        enabled.length === 1
          ? (sources[broken[0].id].reason ?? "A dependency is unavailable")
          : `source '${broken[0].id}': ${sources[broken[0].id].reason}`,
      );
  }

  /**
   * Each source's health: broken when it, or every path from it to an
   * action, holds a node whose dependency is gone.
   */
  public async sources(rule: Automation): Promise<AutomationSourceHealth> {
    const verdicts = await this.verdicts(rule);
    const graph = rule.rule;
    const health: AutomationSourceHealth = {};
    for (const source of this.graphs.sources(graph)) {
      const own = verdicts.get(source.id);
      if (own) {
        health[source.id] = { health: "broken", reason: own };
        continue;
      }
      // Walk only through nodes that can run: an action reached that way
      // means the source can still do something.
      const seen = new Set<string>([source.id]);
      const stack = [source.id];
      let runs = false;
      let reason: string | undefined;
      while (stack.length && !runs) {
        const id = stack.pop()!;
        for (const edge of this.graphs.outgoing(graph, id)) {
          if (seen.has(edge.to)) continue;
          seen.add(edge.to);
          const broken = verdicts.get(edge.to);
          if (broken) {
            reason ??= broken;
            continue;
          }
          if (this.graphs.node(graph, edge.to)?.kind === "action") runs = true;
          stack.push(edge.to);
        }
      }
      health[source.id] = runs
        ? { health: "active" }
        : { health: "broken", reason: reason ?? "No action can run" };
    }
    return health;
  }

  /**
   * Why one node cannot run, or nothing: a lost entry, a capability or an
   * option it needs, a channel it notifies.
   */
  public async reason(
    rule: Automation,
    id: string,
  ): Promise<string | undefined> {
    return (await this.verdicts(rule)).get(id);
  }

  /**
   * The nodes whose dependency is gone: what a run's configuration check
   * leaves to the per-source health rather than read as a refusal.
   */
  public async broken(rule: Automation): Promise<Set<string>> {
    return new Set((await this.verdicts(rule)).keys());
  }

  /**
   * Every node whose dependency is gone, with the reason.
   */
  protected async verdicts(rule: Automation): Promise<Map<string, string>> {
    const capabilities = await this.security.capabilitiesOf(rule.projectId);
    const entries = this.catalog.entries();
    const reserved = this.catalog.reservedNames();
    const names = [...this.catalog.names(rule.rule)].filter(
      (name) => !reserved.has(name),
    );
    const variables = names.length
      ? await this.persistence.variables.findMany({
          where: { projectId: rule.projectId, key: { inArray: names } },
          limit: 64,
        })
      : [];
    const channels = await this.channels.all(rule.projectId);
    const verdicts = new Map<string, string>();
    for (const node of rule.rule.nodes) {
      const reason = this.nodeReason(
        node,
        entries,
        capabilities,
        variables,
        channels,
      );
      if (reason) verdicts.set(node.id, reason);
    }
    return verdicts;
  }

  protected nodeReason(
    node: Automation["rule"]["nodes"][number],
    entries: ReturnType<AutomationCatalog["entries"]>,
    capabilities: Awaited<
      ReturnType<AutomationProjectSecurity["capabilitiesOf"]>
    >,
    variables: Array<{ key: string; value: { kind: string; value: unknown } }>,
    channels: Awaited<ReturnType<AutomationChannels["all"]>>,
  ): string | undefined {
    // Automations are Core (#Q3629): a node needs only what its own entry
    // declares, and what the variables it names hold.
    const needs: { capability: string; option: string }[] = [];
    if (
      node.type !== AutomationVocabulary.SCHEDULE &&
      node.type !== AutomationVocabulary.COMPARE
    ) {
      const entry = entries.find((value) => value.key === node.type);
      if (!entry) return `Automation vocabulary '${node.type}' is unavailable`;
      needs.push(
        ...entry.needs.map((need) => ({ ...need, option: need.option ?? "" })),
      );
    }
    const used = new Set(this.catalog.names(node.config));
    for (const variable of variables) {
      if (!used.has(variable.key)) continue;
      if (variable.value.kind === "folio")
        needs.push({ capability: "remember", option: "" });
      if (variable.value.kind === "release")
        needs.push({ capability: "plan", option: "releases" });
    }
    for (const need of needs) {
      if (!capabilities[need.capability as keyof typeof capabilities])
        return `Missing ${need.capability} capability`;
      if (
        need.option &&
        capabilities[need.capability as keyof typeof capabilities]?.[
          need.option
        ] !== true
      )
        return `Missing ${need.capability}.${need.option} option`;
    }
    if (node.kind !== "action" || node.type !== "notify") return undefined;
    const named = this.graphs.channels(node);
    // A notification left with no channel at all can send nothing (#Q3613).
    if (named.length === 0)
      return "This automation notifies no channel any more";
    for (const name of named) {
      const variable = variables.find((value) => `{{${value.key}}}` === name);
      const channel =
        variable?.value.kind === "channel" ? variable.value.value : name;
      if (
        typeof channel === "string" &&
        !channel.includes("{{") &&
        !channels.some((value) => value.key === channel && value.available)
      )
        return `Automation channel '${channel}' is unavailable`;
    }
    return undefined;
  }
}

export { AutomationDependencyError } from "../errors/AutomationDependencyError.ts";
