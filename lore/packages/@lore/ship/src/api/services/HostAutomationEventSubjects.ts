import { AutomationEventSubjects } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { hosts } from "../entities/hosts.ts";
import { type HostAlertKind, HostEventFields } from "./HostEventFields.ts";

/**
 * The subject a `host.*` rule is previewed against (#Q3627, #Q3733): a host of the
 * project, by id.
 */
export class HostAutomationEventSubjects {
  /**
   * The sentence the automation engine's `{{title}}` reads for each host
   * event. The project event stores the host's slug instead (#Q3889).
   */
  public static readonly titles: Record<
    HostAlertKind,
    (slug: string) => string
  > = {
    credential_invalid: (slug) =>
      `${slug}: its Cloudflare token stopped working`,
    expired: (slug) => `${slug} is past its TTL`,
    offline: (slug) => `${slug} is offline`,
    online: (slug) => `${slug} is back online`,
  };
  protected readonly registry = $inject(AutomationEventSubjects);
  protected readonly projects = $repository(projects);
  protected readonly hosts = $repository(hosts);
  protected readonly fields = $inject(HostEventFields);
  constructor() {
    for (const kind of [
      "credential_invalid",
      "expired",
      "offline",
      "online",
    ] as const)
      this.registry.register(`host.${kind}`, (projectId, id) =>
        this.subject(projectId, id, kind),
      );
  }
  protected async subject(
    projectId: number,
    id: string | number,
    kind: HostAlertKind,
  ) {
    if (typeof id !== "string")
      throw new BadRequestError("Host subjects require a host UUID");
    const host = await this.hosts.getOne({ where: { projectId, id } });
    const project = await this.projects.getById(projectId);
    const since =
      kind === "expired"
        ? (host.expiresAt ?? host.updatedAt)
        : kind === "credential_invalid"
          ? (host.credentialCheckedAt ?? host.updatedAt)
          : (host.offlineSince ?? host.disconnectedAt ?? host.updatedAt);
    return HostAutomationEventSubjects.automation(
      this.fields.build(project, host, kind, since),
      kind,
    );
  }

  /**
   * The automation engine's fields for a host event: the data, with the
   * sentence its templates read as `title`.
   */
  public static automation(
    fields: Record<string, unknown>,
    kind: HostAlertKind,
  ): Record<string, unknown> {
    return {
      ...fields,
      title: HostAutomationEventSubjects.titles[kind](String(fields.host)),
    };
  }

  /**
   * A host source's event: the automation engine's fields, and the project
   * event's data and subject (#Q3889).
   */
  public static source(data: Record<string, unknown>, kind: HostAlertKind) {
    return {
      subjectId: String(data.host_id),
      fields: HostAutomationEventSubjects.automation(data, kind),
      projectFields: data,
    };
  }
}
