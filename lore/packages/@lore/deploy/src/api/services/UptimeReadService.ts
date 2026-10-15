import { $inject, type Infer } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, sql } from "alepha/orm";

import { DeployAnalytics } from "../entities/deployAnalytics.ts";
import { monitorHeartbeats } from "../entities/monitorHeartbeats.ts";
import { monitorIncidents } from "../entities/monitorIncidents.ts";
import { type Monitor, monitors } from "../entities/monitors.ts";
import type { MonitorDetailResource } from "../schemas/monitorDetailResourceSchema.ts";
import { monitorHeartbeatStoredSchema } from "../schemas/monitorHeartbeatStoredSchema.ts";
import type { MonitorListResource } from "../schemas/monitorListResourceSchema.ts";
import { monitorResourceSchema } from "../schemas/monitorResourceSchema.ts";
import type { MonitorWindow } from "../schemas/monitorWindowSchema.ts";

export class UptimeReadService {
  protected readonly monitors = $repository(monitors);
  protected readonly incidents = $repository(monitorIncidents);
  protected readonly beats = $repository(monitorHeartbeats);
  protected readonly analytics = $inject(DeployAnalytics);
  protected readonly clock = $inject(DateTimeProvider);
  protected readonly statusRank = { down: 0, pending: 2, up: 3, paused: 4 };

  public hours(window: MonitorWindow): number {
    return window === "24h" ? 24 : window === "7d" ? 168 : 720;
  }

  public async detail(
    monitor: Monitor,
    window: MonitorWindow,
  ): Promise<MonitorDetailResource> {
    const now = this.clock.nowMillis();
    const cutoff = new Date(now - 719 * 3_600_000).toISOString().slice(0, 13);
    const history = await this.analytics.probes.query({
      since: cutoff.slice(0, 10),
      where: { monitorId: monitor.id },
      groupBy: ["hour"],
      select: { count: "sum", up: "sum", latencyMs: "sum" },
    });
    const uptime = (["24h", "7d", "30d"] as const).map((range) => {
      const since = new Date(now - (this.hours(range) - 1) * 3_600_000)
        .toISOString()
        .slice(0, 13);
      const rows = history.rows.filter((row) => String(row.hour) >= since);
      const count = rows.reduce((sum, row) => sum + Number(row.count), 0);
      const up = rows.reduce((sum, row) => sum + Number(row.up), 0);
      return { window: range, uptimePct: count ? (up / count) * 100 : null };
    });
    const hourly = window === "24h";
    const size = hourly ? 24 : window === "7d" ? 7 : 30;
    const step = hourly ? 3_600_000 : 86_400_000;
    const groups = new Map<
      string,
      { count: number; up: number; latency: number }
    >();
    const chart = hourly
      ? history
      : await this.analytics.probes.query({
          since: new Date(now - (size - 1) * step).toISOString().slice(0, 10),
          where: { monitorId: monitor.id },
          groupBy: ["day"],
          select: { count: "sum", up: "sum", latencyMs: "sum" },
        });
    for (const row of chart.rows) {
      const bucket = String(hourly ? row.hour : row.day);
      const group = groups.get(bucket) ?? { count: 0, up: 0, latency: 0 };
      group.count += Number(row.count);
      group.up += Number(row.up);
      group.latency += Number(row.latencyMs);
      groups.set(bucket, group);
    }
    const points = Array.from({ length: size }, (_, index) => {
      const bucket = new Date(now - (size - index - 1) * step)
        .toISOString()
        .slice(0, hourly ? 13 : 10);
      const group = groups.get(bucket);
      return {
        bucket,
        count: group?.count ?? 0,
        latencyMs: group?.up ? group.latency / group.up : null,
      };
    });
    const beats = await this.beats.findMany({
      where: { monitorId: monitor.id },
      orderBy: [
        { column: "at", direction: "desc" },
        { column: "id", direction: "desc" },
      ],
      limit: 50,
    });
    const incidents = await this.incidents.findMany({
      where: { monitorId: monitor.id },
      orderBy: [{ column: "startedAt", direction: "desc" }],
      limit: 100,
    });
    return {
      monitor: monitorResourceSchema.parse(monitor),
      beats: beats.toReversed(),
      uptime,
      points,
      estimated: history.estimated || chart.estimated,
      incidents: incidents.map((incident) => ({
        ...incident,
        durationSecs: Math.max(
          0,
          ((incident.endedAt ? Date.parse(incident.endedAt) : now) -
            Date.parse(incident.startedAt)) /
            1000,
        ),
      })),
    };
  }

  public async list(
    projectId: number,
    window: MonitorWindow,
  ): Promise<MonitorListResource> {
    const rows = await this.monitors.findMany({ where: { projectId } });
    const totals = new Map<string, { count: number; up: number }>();
    const beats = new Map<string, Infer<typeof monitorHeartbeats.schema>[]>();
    let estimated = false;
    // Windows are hourly buckets, including the current partial hour.
    const cutoff = new Date(
      this.clock.nowMillis() - (this.hours(window) - 1) * 3_600_000,
    )
      .toISOString()
      .slice(0, 13);
    for (let offset = 0; offset < rows.length; offset += 90) {
      const ids = rows.slice(offset, offset + 90).map((row) => row.id);
      const history = await this.analytics.probes.query({
        since: cutoff.slice(0, 10),
        where: { monitorId: { inArray: ids } },
        groupBy: ["monitorId", "hour"],
        select: { count: "sum", up: "sum" },
      });
      estimated ||= history.estimated;
      for (const point of history.rows) {
        if (String(point.hour) < cutoff) continue;
        const id = String(point.monitorId);
        const sum = totals.get(id) ?? { count: 0, up: 0 };
        sum.count += Number(point.count);
        sum.up += Number(point.up);
        totals.set(id, sum);
      }
      const recent = await this.beats.query(
        (table) => sql`
        SELECT * FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY monitor_id ORDER BY at DESC, id DESC) AS position
          FROM ${table} WHERE ${table.monitorId} IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})
        ) ranked WHERE position <= 50 ORDER BY at ASC, id ASC
      `,
        monitorHeartbeatStoredSchema,
      );
      for (const beat of recent) {
        const group = beats.get(beat.monitorId) ?? [];
        group.push(beat);
        beats.set(beat.monitorId, group);
      }
    }
    const rank = (row: Monitor) =>
      row.status === "up" && row.lastResult === "latency"
        ? 1
        : this.statusRank[row.status];
    rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return {
      estimated,
      items: rows.map((row) => {
        const sum = totals.get(row.id);
        return {
          ...monitorResourceSchema.parse(row),
          uptimePct: sum?.count ? (sum.up / sum.count) * 100 : null,
          beats: beats.get(row.id) ?? [],
        };
      }),
    };
  }
}
