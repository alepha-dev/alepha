import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { hostInventories } from "../entities/hostInventories.ts";
import { type Host, hosts } from "../entities/hosts.ts";
import { type DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import type { HostStatsCardFilters } from "../schemas/hostStatsCardFiltersSchema.ts";
import { DashboardMetricRegistry } from "./DashboardMetricRegistry.ts";
import {
  type DashboardMetricResolver,
  type DashboardResolvable,
} from "./DashboardMetricResolver.ts";
import { HostStatsService } from "./HostStatsService.ts";

type CardValue = Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">;

/**
 * `hostStats` (#Q4425): one host's CPU, memory, disk or load, its current
 * reading over a chart of daily means for the board's window.
 *
 * The reading comes from where it is exact: CPU and memory from the row's
 * gauge, disk and load from the last inventory. The series is the host's
 * `host_stats` history, which exists only while its owner keeps it on: a
 * card on a host that does not collect says so (`noData`) rather than draw a
 * flat line.
 */
export class HostStatsMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "hostStats";

  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly stats = $inject(HostStatsService);
  protected readonly hosts = $repository(hosts);
  protected readonly inventories = $repository(hostInventories);

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
    const filters = entry.filters as HostStatsCardFilters;
    const host = await this.pick(project.id, filters.host);
    if (!host) return { empty: "noData", detail: {} };

    const measure = filters.measure ?? "cpu";
    const inventory = await this.inventories.findOne({
      where: { hostId: { eq: host.id } },
    });
    const machine = inventory?.machine;
    const current =
      measure === "cpu"
        ? host.cpuPercent
        : measure === "memory"
          ? host.memoryPercent
          : measure === "disk"
            ? machine?.diskTotalBytes && machine.diskUsedBytes !== undefined
              ? (machine.diskUsedBytes / machine.diskTotalBytes) * 100
              : undefined
            : machine?.load1;

    const days = entry.windowDays;
    const since = new Date(
      this.dateTime.nowMillis() - days * 24 * 3600_000,
    ).toISOString();
    const series = host.collectSeries
      ? await this.stats.series(host.id, since)
      : undefined;
    const key = (
      {
        cpu: "cpuPercent",
        memory: "memoryPercent",
        disk: "diskPercent",
        load: "load1",
      } as const
    )[measure];
    const points = (series?.points ?? [])
      .filter((point) => point[key] !== undefined)
      .map((point) => ({
        at: point.day,
        value: Math.round((point[key] ?? 0) * 100) / 100,
      }));

    if (current === undefined && points.length === 0) {
      return { empty: "noData", detail: { host: host.slug, measure } };
    }
    const slug = project.slug ?? "";
    return {
      ...(current === undefined
        ? {}
        : { value: Math.round(current * 100) / 100 }),
      ...(measure === "load" ? {} : { unit: "percent" as const }),
      series: points,
      ...(series?.estimated ? { estimated: true } : {}),
      detail: {
        host: host.slug,
        measure,
        // Names the measure in the card's header: four cards of one host
        // otherwise read as one title four times.
        subtitle: measure,
        collecting: host.collectSeries,
      },
      ...(slug && host.type === "bay"
        ? {
            link: {
              route: "bay",
              params: { projectSlug: slug, hostSlug: host.slug },
            },
          }
        : {}),
    };
  }

  /**
   * The host a card names, among the project's own; empty is the first one
   * by slug.
   */
  protected async pick(
    projectId: number,
    slug: string | undefined,
  ): Promise<Host | undefined> {
    const own = await this.hosts.findMany({
      where: {
        projectId: { eq: projectId },
        ...(slug ? { slug: { eq: slug } } : {}),
      },
      orderBy: [{ column: "slug", direction: "asc" }],
      limit: 1,
    });
    return own[0];
  }
}
