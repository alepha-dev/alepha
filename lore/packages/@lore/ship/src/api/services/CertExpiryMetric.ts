import {
  DashboardMetricRegistry,
  type DashboardMetricResolver,
  type DashboardResolvable,
} from "@lore/core/api";
import {
  type DashboardCardValue,
  hostInventories,
  hosts,
} from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { monitors } from "../entities/monitors.ts";

type CardValue = Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">;
type CardRow = NonNullable<CardValue["rows"]>[number];

/**
 * `certExpiry` (#Q4426): every monitor that knows a TLS certificate's expiry
 * (a `cert` monitor, or an https one that read it), and every certificate the
 * project's Bays serve, as their inventory last reported it from Bay's own
 * TLS store (#Q4441), with its days left. Red when expired, amber inside the
 * warning window (the monitor's, 14 days by default and for a Bay's), green
 * otherwise. The value is the fewest days left.
 *
 * A Bay's rows need no socket, so the tile works on a Lore running on
 * Workers, where a `cert` monitor cannot (#Q4431).
 */
export class CertExpiryMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "certExpiry";

  /**
   * The most certificates the tile lists, monitors and Bays together.
   */
  protected readonly maxRows = 50;

  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly monitors = $repository(monitors);
  protected readonly hosts = $repository(hosts);
  protected readonly inventories = $repository(hostInventories);

  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<Map<number, CardValue>> {
    const out = new Map<number, CardValue>();
    for (const entry of cards) {
      const project = entry.scope.projects[0];
      if (!project) {
        out.set(entry.card.id, { empty: "noData", detail: {} });
        continue;
      }
      const rows: CardRow[] = (
        await this.monitors.findMany({
          where: {
            projectId: { eq: project.id },
            certExpiresAt: { isNotNull: true },
          },
          orderBy: [{ column: "certExpiresAt", direction: "asc" }],
          limit: this.maxRows,
        })
      ).map((monitor) => {
        const days = this.daysLeft(monitor.certExpiresAt!);
        return {
          title: monitor.name,
          value: days,
          meta: `${days} d`,
          state: this.state(days, monitor.expect.certWarningDays ?? 14),
          ...(project.slug
            ? {
                link: {
                  route: "projectMonitor",
                  params: {
                    projectSlug: project.slug,
                    monitorId: monitor.id,
                  },
                },
              }
            : {}),
        };
      });
      rows.push(...(await this.bayRows(project.id, project.slug)));
      rows.sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
      rows.splice(this.maxRows);
      if (rows.length === 0) {
        out.set(entry.card.id, { empty: "noData", detail: {} });
        continue;
      }
      out.set(entry.card.id, {
        value: Math.min(...rows.map((row) => row.value ?? 0)),
        rows,
        detail: { certificates: rows.length },
      });
    }
    return out;
  }

  /**
   * The certificates of the domains the project's own Bays serve, from each
   * one's last inventory, linked to its host page.
   */
  protected async bayRows(projectId: number, projectSlug?: string) {
    const own = await this.hosts.findMany({
      where: { projectId: { eq: projectId }, type: { eq: "bay" } },
      orderBy: [{ column: "slug", direction: "asc" }],
    });
    const rows: CardRow[] = [];
    for (const host of own) {
      const inventory = await this.inventories.findOne({
        where: { hostId: { eq: host.id } },
      });
      for (const cert of inventory?.machine?.certificates ?? []) {
        const at = Date.parse(cert.notAfter);
        if (Number.isNaN(at)) continue;
        const days = this.daysLeft(cert.notAfter);
        rows.push({
          id: `${host.slug}:${cert.domain}`,
          title: cert.domain,
          value: days,
          meta: `${days} d`,
          state: this.state(days, 14),
          ...(projectSlug
            ? {
                link: {
                  route: "bay",
                  params: { projectSlug, hostSlug: host.slug },
                },
              }
            : {}),
        });
      }
    }
    return rows;
  }

  protected daysLeft(expiresAt: string): number {
    return Math.floor(
      (Date.parse(expiresAt) - this.dateTime.nowMillis()) / (24 * 3600_000),
    );
  }

  protected state(days: number, warning: number) {
    return days < 0
      ? ("bad" as const)
      : days <= warning
        ? ("warn" as const)
        : ("ok" as const);
  }
}
