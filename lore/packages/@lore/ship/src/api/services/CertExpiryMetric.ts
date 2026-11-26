import {
  DashboardMetricRegistry,
  type DashboardMetricResolver,
  type DashboardResolvable,
} from "@lore/core/api";
import { type DashboardCardValue } from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { monitors } from "../entities/monitors.ts";

type CardValue = Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">;

/**
 * `certExpiry` (#Q4426): every monitor that knows a TLS certificate's expiry
 * (a `cert` monitor, or an https one that read it), with its days left. Red
 * when expired, amber inside the monitor's warning window (14 days by
 * default), green otherwise. The value is the fewest days left.
 */
export class CertExpiryMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "certExpiry";

  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly monitors = $repository(monitors);

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
      const rows = (
        await this.monitors.findMany({
          where: {
            projectId: { eq: project.id },
            certExpiresAt: { isNotNull: true },
          },
          orderBy: [{ column: "certExpiresAt", direction: "asc" }],
          limit: 50,
        })
      ).map((monitor) => {
        const days = Math.floor(
          (Date.parse(monitor.certExpiresAt!) - this.dateTime.nowMillis()) /
            (24 * 3600_000),
        );
        const warning = monitor.expect.certWarningDays ?? 14;
        return {
          title: monitor.name,
          value: days,
          meta: `${days} d`,
          state:
            days < 0
              ? ("bad" as const)
              : days <= warning
                ? ("warn" as const)
                : ("ok" as const),
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
      if (rows.length === 0) {
        out.set(entry.card.id, { empty: "noData", detail: {} });
        continue;
      }
      out.set(entry.card.id, {
        value: Math.min(...rows.map((row) => row.value)),
        rows,
        detail: { certificates: rows.length },
      });
    }
    return out;
  }
}
