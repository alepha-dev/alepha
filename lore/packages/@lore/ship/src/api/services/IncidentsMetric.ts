import {
  DashboardMetricRegistry,
  type DashboardMetricResolver,
  type DashboardResolvable,
} from "@lore/core/api";
import { type DashboardCardValue, hostEvents, hosts } from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { monitorIncidents } from "../entities/monitorIncidents.ts";
import { monitors } from "../entities/monitors.ts";

type CardValue = Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">;
type Row = NonNullable<DashboardCardValue["rows"]>[number];

/**
 * `incidents` (#Q4426): what happened to the project's apps and hosts over
 * the board's window (at least 30 days), newest first. Two sources side by
 * side, so a deploy reads next to the outage it did or did not cause:
 *
 * - every uptime incident, with how long it lasted (or that it is open);
 * - every change of a watched unit on the project's own hosts (#Q4421), which
 *   is how a restart or a deploy shows without a hook in a release script.
 *
 * The value is how many outages the window holds.
 */
export class IncidentsMetric implements DashboardMetricResolver {
  /** The most rows a feed shows, the card value's own bound. */
  public static readonly LIMIT = 50;

  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "incidents";

  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly monitors = $repository(monitors);
  protected readonly incidents = $repository(monitorIncidents);
  protected readonly hosts = $repository(hosts);
  protected readonly events = $repository(hostEvents);

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
    const days = Math.max(entry.windowDays, 30);
    const since = new Date(
      this.dateTime.nowMillis() - days * 24 * 3600_000,
    ).toISOString();

    const [watched, own] = await Promise.all([
      this.monitors.findMany({ where: { projectId: { eq: project.id } } }),
      this.hosts.findMany({ where: { projectId: { eq: project.id } } }),
    ]);
    const names = new Map(watched.map((monitor) => [monitor.id, monitor]));
    const [outages, changes] = await Promise.all([
      watched.length
        ? this.incidents.findMany({
            where: {
              monitorId: { inArray: [...names.keys()] },
              startedAt: { gte: since },
            },
            orderBy: [{ column: "startedAt", direction: "desc" }],
            limit: IncidentsMetric.LIMIT,
          })
        : [],
      own.length
        ? this.events.findMany({
            where: {
              hostId: { inArray: own.map((host) => host.id) },
              kind: { eq: "unit.changed" },
              at: { gte: since },
            },
            orderBy: [{ column: "at", direction: "desc" }],
            limit: IncidentsMetric.LIMIT,
          })
        : [],
    ]);

    const slugs = new Map(own.map((host) => [host.id, host.slug]));
    const rows: Row[] = [
      ...outages.map((incident): Row => {
        const monitor = names.get(incident.monitorId);
        return {
          title: `${monitor?.name ?? "monitor"} down`,
          excerpt: `${
            incident.endedAt
              ? this.duration(incident.startedAt, incident.endedAt)
              : "ongoing"
          }, ${incident.cause}`,
          at: incident.startedAt,
          state: incident.endedAt ? "warn" : "bad",
          ...(project.slug && monitor
            ? {
                link: {
                  route: "projectMonitor",
                  params: { projectSlug: project.slug, monitorId: monitor.id },
                },
              }
            : {}),
        };
      }),
      ...changes.map((event): Row => {
        const data = (event.data ?? {}) as Record<string, unknown>;
        const unit = typeof data.unit === "string" ? data.unit : "unit";
        const from = typeof data.from === "string" ? data.from : "?";
        const to = typeof data.to === "string" ? data.to : "?";
        return {
          title: `${unit}: ${from} to ${to}`,
          excerpt: slugs.get(event.hostId) ?? "",
          at: event.at,
          state:
            to === "failed" || to === "not-found"
              ? "bad"
              : to === "active"
                ? "ok"
                : "neutral",
        };
      }),
    ]
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, IncidentsMetric.LIMIT);

    if (rows.length === 0) return { empty: "noData", detail: {} };
    return {
      value: outages.length,
      rows,
      detail: { outages: outages.length, changes: changes.length },
    };
  }

  /** A closed outage's length as a person reads it: `14 min`, `2 h 5 min`. */
  protected duration(start: string, end: string): string {
    const minutes = Math.max(
      0,
      Math.round((Date.parse(end) - Date.parse(start)) / 60_000),
    );
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
}
