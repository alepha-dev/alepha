import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { hostInventories } from "../entities/hostInventories.ts";
import { hosts } from "../entities/hosts.ts";
import { type DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import type { HostUnitsCardFilters } from "../schemas/hostUnitsCardFiltersSchema.ts";
import { DashboardMetricRegistry } from "./DashboardMetricRegistry.ts";
import {
  type DashboardMetricResolver,
  type DashboardResolvable,
} from "./DashboardMetricResolver.ts";

type CardValue = Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">;

/**
 * `hostUnits` (#Q4425): the systemd units a host watches, as its Bay last
 * read them, one status pill each. Green `active`, red `failed` or missing,
 * amber in between (a restart or a deploy under way). The value is how many
 * are active.
 */
export class HostUnitsMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "hostUnits";

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
    const filters = entry.filters as HostUnitsCardFilters;
    const own = await this.hosts.findMany({
      where: {
        projectId: { eq: project.id },
        ...(filters.host ? { slug: { eq: filters.host } } : {}),
      },
      orderBy: [{ column: "slug", direction: "asc" }],
    });
    const host = own.find((it) => it.watchUnits?.length) ?? own[0];
    if (!host) return { empty: "noData", detail: {} };
    const inventory = await this.inventories.findOne({
      where: { hostId: { eq: host.id } },
    });
    const units = inventory?.machine?.units ?? [];
    if (units.length === 0) {
      return { empty: "noData", detail: { host: host.slug } };
    }
    const slug = project.slug ?? "";
    const link =
      slug && host.type === "bay"
        ? {
            route: "bay",
            params: { projectSlug: slug, hostSlug: host.slug },
          }
        : undefined;
    const rows = units.map((unit) => ({
      id: unit.name,
      title: unit.name,
      meta: unit.subState
        ? `${unit.activeState} (${unit.subState})`
        : unit.activeState,
      ...(unit.since ? { at: unit.since } : {}),
      state:
        unit.activeState === "active"
          ? ("ok" as const)
          : unit.activeState === "failed" || unit.activeState === "not-found"
            ? ("bad" as const)
            : ("warn" as const),
      ...(link ? { link } : {}),
    }));
    return {
      value: rows.filter((row) => row.state === "ok").length,
      rows,
      detail: { host: host.slug, units: rows.length },
      ...(link ? { link } : {}),
    };
  }
}
