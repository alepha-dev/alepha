import { $inject, type Infer } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, sql } from "alepha/orm";

import { DeployAnalytics } from "../entities/deployAnalytics.ts";
import { monitorHeartbeats } from "../entities/monitorHeartbeats.ts";
import { type Monitor, monitors } from "../entities/monitors.ts";
import { monitorHeartbeatStoredSchema } from "../schemas/monitorHeartbeatStoredSchema.ts";
import type { MonitorListResource } from "../schemas/monitorListResourceSchema.ts";
import { monitorResourceSchema } from "../schemas/monitorResourceSchema.ts";
import type { MonitorWindow } from "../schemas/monitorWindowSchema.ts";

export class UptimeReadService {
  protected readonly monitors = $repository(monitors);
  protected readonly beats = $repository(monitorHeartbeats);
  protected readonly analytics = $inject(DeployAnalytics);
  protected readonly clock = $inject(DateTimeProvider);
  protected readonly statusRank = { down: 0, pending: 2, up: 3, paused: 4 };

  public hours(window: MonitorWindow): number {
    return window === "24h" ? 24 : window === "7d" ? 168 : 720;
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
