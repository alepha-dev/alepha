import { $inject } from "alepha";

import type { Automation } from "../entities/automations.ts";
import { AutomationDependencyError } from "../errors/AutomationDependencyError.ts";
import { AutomationGraph } from "../schemas/AutomationGraph.ts";
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

  public async assert(rule: Automation): Promise<void> {
    const capabilities = await this.security.capabilitiesOf(rule.projectId);
    // Automations are Core (#Q3629): a rule needs only what its own
    // vocabulary declares.
    const needs: { capability: string; option: string }[] = [];
    // Every node's entry: its events, its read, its actions (#Q3805).
    const keys = [
      ...new Set(
        rule.rule.nodes
          .filter(
            (node) =>
              node.type !== AutomationVocabulary.SCHEDULE &&
              node.type !== AutomationVocabulary.COMPARE,
          )
          .map((node) => node.type),
      ),
    ];
    const entries = this.catalog.entries();
    for (const key of keys) {
      const entry = entries.find((value) => value.key === key);
      if (!entry)
        throw new AutomationDependencyError(
          `Automation vocabulary '${key}' is unavailable`,
        );
      needs.push(
        ...entry.needs.map((need) => ({ ...need, option: need.option ?? "" })),
      );
    }
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
    for (const variable of variables) {
      if (variable.value.kind === "folio")
        needs.push({ capability: "remember", option: "" });
      if (variable.value.kind === "release")
        needs.push({ capability: "plan", option: "releases" });
    }
    for (const need of needs) {
      if (!capabilities[need.capability as keyof typeof capabilities])
        throw new AutomationDependencyError(
          `Missing ${need.capability} capability`,
        );
      if (
        need.option &&
        capabilities[need.capability as keyof typeof capabilities]?.[
          need.option
        ] !== true
      )
        throw new AutomationDependencyError(
          `Missing ${need.capability}.${need.option} option`,
        );
    }
    const channels = await this.channels.all(rule.projectId);
    for (const node of rule.rule.nodes) {
      if (node.kind !== "action" || node.type !== "notify") continue;
      const named = this.graphs.channels(node);
      // A rule left with no channel at all can send nothing (#Q3613).
      if (named.length === 0)
        throw new AutomationDependencyError(
          "This automation notifies no channel any more",
        );
      for (const name of named) {
        const variable = variables.find((value) => `{{${value.key}}}` === name);
        const channel =
          variable?.value.kind === "channel" ? variable.value.value : name;
        if (
          typeof channel === "string" &&
          !channel.includes("{{") &&
          !channels.some((value) => value.key === channel && value.available)
        )
          throw new AutomationDependencyError(
            `Automation channel '${channel}' is unavailable`,
          );
      }
    }
  }
}

export { AutomationDependencyError } from "../errors/AutomationDependencyError.ts";
