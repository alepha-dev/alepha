import { AutomationEventSubjects } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { hosts } from "../entities/hosts.ts";
import { HostAutomationFields } from "./HostAutomationFields.ts";

/**
 * The subject a `host.*` rule is previewed against (#Q3627): a host of the
 * project, by id.
 */
export class HostAutomationEventSubjects {
  protected readonly registry = $inject(AutomationEventSubjects);
  protected readonly projects = $repository(projects);
  protected readonly hosts = $repository(hosts);
  protected readonly fields = $inject(HostAutomationFields);
  constructor() {
    for (const kind of ["credential_invalid", "expired"] as const)
      this.registry.register(`host.${kind}`, (projectId, id) =>
        this.subject(projectId, id, kind),
      );
  }
  protected async subject(
    projectId: number,
    id: string | number,
    kind: "credential_invalid" | "expired",
  ) {
    if (typeof id !== "string")
      throw new BadRequestError("Host subjects require a host UUID");
    const host = await this.hosts.getOne({ where: { projectId, id } });
    const project = await this.projects.getById(projectId);
    const since =
      kind === "expired"
        ? (host.expiresAt ?? host.updatedAt)
        : (host.credentialCheckedAt ?? host.updatedAt);
    return this.fields.build(project, host, kind, since);
  }
}
