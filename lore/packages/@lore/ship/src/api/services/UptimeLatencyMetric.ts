import {
  DashboardMetricRegistry,
  type DashboardMetricResolver,
  type DashboardResolvable,
} from "@lore/core/api";
import { type DashboardCardValue } from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { DeployAnalytics } from "../entities/deployAnalytics.ts";
import { monitors } from "../entities/monitors.ts";
import type { UptimeLatencyCardFilters } from "../schemas/uptimeLatencyCardFiltersSchema.ts";

type CardValue = Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">;

/**
 * `uptimeLatency` (#Q4426): one http monitor's mean response time per day
 * over the board's window, from the `uptime_probes`
 * totals, with its last check as the value.
 *
 * The totals hold a latency sum over passing checks only and their count
 * (`up`), so the mean of a day is `latencyMs / up`: a day of failures has no
 * point rather than a zero that reads as fast.
 */
export class UptimeLatencyMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "uptimeLatency";

  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly analytics = $inject(DeployAnalytics);
  protected readonly monitors = $repository(monitors);

  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<Map<number, CardValue>> {
    const out = new Map<number, CardValue>();
    for (const entry of cards) {
      out.set(entry.card.id, await this.resolve(entry));
    }
    return out;
  }

  protected async resolve(entry: DashboardResolvable): Promise<CardValue> {
    const project = entry.scope.projects[0];
    if (!project) return { empty: "noData", detail: {} };
    const filters = entry.filters as UptimeLatencyCardFilters;
    const [monitor] = await this.monitors.findMany({
      where: {
        projectId: { eq: project.id },
        kind: { eq: "http" },
        ...(filters.monitor ? { name: { eq: filters.monitor } } : {}),
      },
      orderBy: [{ column: "name", direction: "asc" }],
      limit: 1,
    });
    if (!monitor) return { empty: "noData", detail: {} };

    const days = entry.windowDays;
    const since = new Date(
      this.dateTime.nowMillis() - days * 24 * 3600_000,
    ).toISOString();
    const result = await this.analytics.probes.query({
      since,
      where: { monitorId: { inArray: [monitor.id] } },
      groupBy: ["day"],
      select: { latencyMs: "sum", up: "sum" },
    });
    const series = result.rows
      .filter((row) => Number(row.up ?? 0) > 0)
      .map((row) => ({
        at: String(row.day),
        value: Math.round(Number(row.latencyMs) / Number(row.up)),
      }))
      .sort((a, b) => a.at.localeCompare(b.at));
    if (series.length === 0 && monitor.lastLatencyMs === undefined) {
      return { empty: "noData", detail: { monitor: monitor.name } };
    }
    return {
      ...(monitor.lastLatencyMs === undefined
        ? {}
        : { value: monitor.lastLatencyMs }),
      series,
      ...(result.estimated ? { estimated: true } : {}),
      detail: { monitor: monitor.name, unit: "ms" },
      ...(project.slug
        ? {
            link: {
              route: "projectMonitor",
              params: { projectSlug: project.slug, monitorId: monitor.id },
            },
          }
        : {}),
    };
  }
}
