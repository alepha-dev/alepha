import { $inject, AlephaError } from "alepha";

import type { Automation } from "../entities/automations.ts";
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

  public async assert(rule: Automation): Promise<void> {
    const capabilities = await this.security.capabilitiesOf(rule.projectId);
    const needs = [{ capability: "work", option: "automations" }];
    const keys = [
      rule.rule.trigger.kind === "event"
        ? rule.rule.trigger.event
        : rule.rule.select!.key,
      ...rule.rule.actions.map((action) => action.kind),
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
        needs.push({ capability: "knowledge", option: "" });
      if (variable.value.kind === "release")
        needs.push({ capability: "work", option: "releases" });
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
    if (
      rule.enabled &&
      rule.rule.compatibility &&
      !(await this.persistence.adoptions.findOne({
        where: {
          projectId: rule.projectId,
          policy: rule.rule.compatibility,
          automationId: rule.id,
          state: "adopted",
        },
      }))
    )
      throw new AutomationDependencyError(
        "Compatibility policy has not been explicitly adopted",
      );
    const channels = await this.channels.all(rule.projectId);
    for (const action of rule.rule.actions) {
      if (action.kind !== "notify") continue;
      const variable = variables.find(
        (value) => `{{${value.key}}}` === action.channel,
      );
      const channel =
        variable?.value.kind === "channel"
          ? variable.value.value
          : action.channel;
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

export class AutomationDependencyError extends AlephaError {}
