import {
  DashboardMetricRegistry,
  type DashboardMetricResolver,
  type DashboardResolvable,
} from "@lore/core/api";
import {
  type DashboardCardValue,
  DashboardMetricCatalog,
} from "@lore/core/schemas";
import { $inject } from "alepha";

import { UptimeReadService } from "./UptimeReadService.ts";

/**
 * The Uptime card (#Q3781): each of the project's monitors, its current
 * state, and its availability over the last 24 hours as a bar, from the very
 * list the Apps page's Uptime column reads (`UptimeReadService.list`), in
 * its order (down first).
 *
 * A row links to its monitor's address, which opens the owning app's Uptime
 * tab (`projectMonitor`, #Q3677), so the card follows that page wherever it
 * lives. Gated by Ship's `uptime` option in the catalogue.
 */
export class UptimeMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "uptime";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly uptime = $inject(UptimeReadService);

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
      const list = await this.uptime.list(project.id, "24h");
      if (list.items.length === 0) {
        out.set(entry.card.id, { empty: "noData", detail: {} });
        continue;
      }
      const rows = list.items.map((monitor) => {
        const status = monitor.active ? monitor.status : "paused";
        const state =
          status === "up"
            ? ("ok" as const)
            : status === "down"
              ? ("bad" as const)
              : status === "pending"
                ? ("warn" as const)
                : ("neutral" as const);
        return {
          title: monitor.name,
          badge: status,
          state,
          // The 24-hour availability as the row's bar, when anything was
          // measured: an unmeasured monitor draws no bar rather than an
          // empty one that reads as 0%.
          ...(monitor.uptimePct !== null
            ? { progress: Math.max(0, Math.min(100, monitor.uptimePct)) }
            : {}),
          ...(slug
            ? {
                link: {
                  route: "projectMonitor",
                  params: { projectSlug: slug, monitorId: monitor.id },
                },
              }
            : {}),
        };
      });
      out.set(entry.card.id, {
        value: rows.filter((row) => row.state === "ok").length,
        rows,
        estimated: list.estimated,
        detail: { monitors: rows.length },
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: slug,
        }),
      });
    }
    return out;
  }
}
