import {
  DashboardMetricRegistry,
  type DashboardMetricResolver,
  type DashboardResolvable,
} from "@lore/core/api";
import {
  type DashboardCardValue,
  DashboardMetricCatalog,
  hostProjects,
  type Host,
  hosts,
} from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { HostService } from "./HostService.ts";

/**
 * The Hosts card (#Q3781): the project's hosts, the ones it is home to and
 * the ones lent to it, each with its state and when it was last heard from.
 *
 * Online is the host page's own rule (`HostService.isOnline`), never a
 * second one. A row of a Bay host this project is home to links to its
 * console; a lent host's console belongs to its home project, which the
 * reader may not be a member of, so that row links nowhere rather than to a
 * 403. Gated by `host:read` in the catalogue.
 */
export class HostsMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "hosts";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly hostService = $inject(HostService);
  protected readonly hosts = $repository(hosts);
  protected readonly loans = $repository(hostProjects);

  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<
    Map<number, Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">>
  > {
    const out = new Map<
      number,
      Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">
    >();
    for (const entry of cards) {
      const project = entry.scope.projects[0];
      if (!project) {
        out.set(entry.card.id, { empty: "noData", detail: {} });
        continue;
      }
      const slug = project.slug ?? "";
      const [owned, grants] = await Promise.all([
        this.hosts.findMany({
          where: { projectId: { eq: project.id } },
          orderBy: [{ column: "slug", direction: "asc" }],
        }),
        this.loans.findMany({ where: { projectId: { eq: project.id } } }),
      ]);
      // A host homed here is usually lent here too: that grant is what
      // makes it a deploy target of its own project. It is listed once, as
      // a home host (#Q3821).
      const homed = new Set(owned.map((host) => host.id));
      const lentIds = grants
        .map((grant) => grant.hostId)
        .filter((id) => !homed.has(id));
      const lent = lentIds.length
        ? await this.hosts.findMany({
            where: { id: { inArray: lentIds } },
            orderBy: [{ column: "slug", direction: "asc" }],
          })
        : [];
      if (owned.length + lent.length === 0) {
        out.set(entry.card.id, { empty: "noData", detail: {} });
        continue;
      }
      const row = (host: Host, home: boolean) => {
        const online = this.hostService.isOnline(host);
        return {
          id: host.slug,
          title: host.label ?? host.slug,
          badge: online ? "online" : "offline",
          state: online ? ("ok" as const) : ("bad" as const),
          ...(host.lastSeenAt ? { at: host.lastSeenAt } : {}),
          ...(home && host.type === "bay" && slug
            ? {
                link: {
                  route: "bay",
                  params: { projectSlug: slug, hostSlug: host.slug },
                },
              }
            : {}),
        };
      };
      const rows = [
        ...owned.map((host) => row(host, true)),
        ...lent.map((host) => row(host, false)),
      ];
      out.set(entry.card.id, {
        value: rows.filter((it) => it.state === "ok").length,
        rows,
        detail: { hosts: rows.length },
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: slug,
        }),
      });
    }
    return out;
  }
}
