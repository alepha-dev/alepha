import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { DeployAnalytics } from "../entities/deployAnalytics.ts";
import { type Host, hosts } from "../entities/hosts.ts";
import type { HostStatsFrame } from "../schemas/hostStatsFrameSchema.ts";

/**
 * One day of a host's series, averaged from what the dataset holds.
 */
export interface HostStatsPoint {
  day: string;
  cpuPercent: number;
  memoryPercent: number;
  samples: number;
}

/**
 * The series with its epistemics attached: on Analytics Engine a window is
 * sampled, and `estimated` / `sampleInterval` are what a renderer has to
 * disclose beside the line. They travel with the points so no reader can
 * take one without the other.
 */
export interface HostStatsSeries {
  points: HostStatsPoint[];
  estimated: boolean;
  sampleInterval?: number;
}

/**
 * What Lore does with a stats push: the gauge and the series (#1627).
 *
 * The websocket endpoint owns the connection and stamps `lastSeenAt` itself,
 * then hands the validated frame here. This split is deliberate: the
 * endpoint knows sockets and the service knows what a measurement is, and
 * the two facts should not be in one file.
 *
 * Two destinations, because "CPU is 34% right now" and "CPU over 30 days"
 * are two different questions:
 *
 * - the **gauge** is an upsert on the host row: exact, one row per host,
 *   never grows, and the host list renders it with no analytics round
 *   trip. Always written, whatever the switches say, because the list reads
 *   it.
 * - the **series** is the `host_stats` `$analytics` dataset, written only
 *   while the owner's `collectSeries` switch is on. On Workers that is one
 *   `writeDataPoint` into Analytics Engine, not a D1 write.
 *
 * ⚠️ Nothing here appends a row per push to D1. That was the obvious design
 * and it is the expensive one: D1 rows written cost about three times what
 * requests do, so a per-push append would dominate the bill regardless of
 * cadence (folio #1152). The row is updated in place and the series goes to
 * the dataset.
 *
 * ⚠️ The gauge is never read back from the dataset. Every measure comes back
 * as a sample-corrected sum, and "CPU right now" is not a sum.
 *
 * `statsAt` is Lore's clock, not the frame's `at`. The machine's clock is a
 * claim the schema validates and nothing stores: a host whose clock is hours
 * off would otherwise show "measured 3 hours ago" beside a `lastSeenAt` of a
 * second ago, and Analytics Engine cannot backdate a row anyway.
 */
export class HostStatsService {
  protected readonly hosts = $repository(hosts);
  protected readonly analytics = $inject(DeployAnalytics);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The gauge, then the series if the switch is on.
   *
   * Takes the row the endpoint already loaded for this frame, so the
   * `collectSeries` read costs nothing extra and flipping the switch takes
   * effect on the very next push, with no reconnect.
   */
  async record(host: Host, frame: HostStatsFrame): Promise<void> {
    await this.hosts.updateById(host.id, {
      cpuPercent: frame.cpuPercent,
      memoryPercent: frame.memoryPercent,
      statsAt: this.now(),
    });

    if (!host.collectSeries) {
      return;
    }

    // Sums and a sample count rather than the percentages themselves,
    // because `sum` is the only aggregate that survives a rollup and a
    // sampled backend: the mean of a day is `cpu / samples` on the way out,
    // never a stored average of averages.
    await this.analytics.stats.record({
      hostId: host.id,
      cpu: frame.cpuPercent,
      memory: frame.memoryPercent,
      samples: 1,
    });
  }

  /**
   * The series, one point per day, averaged from the dataset's sums.
   *
   * The only read path there is, and the reason there is one: the division
   * by `samples` and the `estimated` / `sampleInterval` disclosure belong in
   * one place, not in every page that draws the line.
   */
  async series(hostId: string, since: string): Promise<HostStatsSeries> {
    const result = await this.analytics.stats.query({
      since,
      where: { hostId: { inArray: [hostId] } },
      groupBy: ["day"],
      select: { cpu: "sum", memory: "sum", samples: "sum" },
    });

    const points = result.rows
      .map((row) => {
        const samples = Number(row.samples ?? 0);
        return {
          day: String(row.day),
          cpuPercent: samples ? Number(row.cpu) / samples : 0,
          memoryPercent: samples ? Number(row.memory) / samples : 0,
          samples,
        };
      })
      .sort((a, b) => a.day.localeCompare(b.day));

    return {
      points,
      estimated: result.estimated,
      ...(result.sampleInterval === undefined
        ? {}
        : { sampleInterval: result.sampleInterval }),
    };
  }

  protected now(): string {
    return new Date(this.dateTime.nowMillis()).toISOString();
  }
}
