import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { hosts } from "../entities/hosts.ts";
import { ProjectEventCatalog } from "./ProjectEventCatalog.ts";
import { ProjectEventFilters } from "./ProjectEventFilters.ts";

/**
 * The host project events (#Q3889), core's since #E166 (#Q4115): a host goes
 * offline, comes back, outlives its time to live or holds a Cloudflare token
 * that stopped working, or a unit it watches fails and recovers (#Q4422).
 * None needs a capability: hosts work with Ship off,
 * and a project that only stores hosts still hears about them. A filter
 * narrows each to one host of the project.
 */
export class HostProjectEvents {
  protected static readonly TITLES: Record<string, string> = {
    "host.credential_invalid": "has a Cloudflare token that stopped working",
    "host.expired": "is past its time to live",
    "host.offline": "is offline",
    "host.online": "is back online",
    "host.unit_failed": "has a watched unit that failed",
    "host.unit_recovered": "has a watched unit running again",
  };
  protected static readonly TEXTS: Record<string, string> = {
    "host.credential_invalid": "Replace the token in the host's settings.",
    "host.expired": "Its time to live ran out.",
    "host.offline": "It stopped reporting past its grace period.",
    "host.online": "It is reporting again.",
    "host.unit_failed": "A systemd unit the host watches stopped.",
    "host.unit_recovered": "The unit that failed is active again.",
  };
  protected readonly catalog = $inject(ProjectEventCatalog);
  protected readonly filters = $inject(ProjectEventFilters);
  protected readonly hosts = $repository(hosts);

  constructor() {
    // What a filter may name, picked on the Notifications page (#Q3892):
    // the project's own hosts, by the value each event carries.
    this.filters.register("host", async (projectId) =>
      (
        await this.hosts.findMany({
          where: { projectId },
          orderBy: "slug",
          limit: 500,
        })
      ).map((host) => ({ value: host.id, label: host.label ?? host.slug })),
    );
    for (const [name, label] of [
      ["host.credential_invalid", "Host token stopped working"],
      ["host.expired", "Host past its TTL"],
      ["host.offline", "Host offline"],
      ["host.online", "Host back online"],
    ] as const)
      this.catalog.register({
        name,
        label,
        resource: "hosts",
        subject: "host",
        fields: {
          host_id: "text",
          host: "text",
          kind: "text",
          state: "text",
          since: "text",
        },
        permission: "host:read",
        filter: { field: "host_id", resource: "host" },
        message: (it) => ({
          title: `${it.host === null || it.host === undefined ? "" : String(it.host)} ${HostProjectEvents.TITLES[name]}`,
          text: HostProjectEvents.TEXTS[name],
        }),
      });
    for (const [name, label] of [
      ["host.unit_failed", "Watched unit failed"],
      ["host.unit_recovered", "Watched unit recovered"],
    ] as const)
      this.catalog.register({
        name,
        label,
        resource: "hosts",
        subject: "host",
        fields: {
          host_id: "text",
          host: "text",
          unit: "text",
          state: "text",
          since: "text",
        },
        permission: "host:read",
        filter: { field: "host_id", resource: "host" },
        message: (it) => ({
          title: `${it.host === null || it.host === undefined ? "" : String(it.host)} ${HostProjectEvents.TITLES[name]}`,
          text: `${it.unit === null || it.unit === undefined ? "" : `${String(it.unit)}: `}${HostProjectEvents.TEXTS[name]}`,
        }),
      });
  }
}
