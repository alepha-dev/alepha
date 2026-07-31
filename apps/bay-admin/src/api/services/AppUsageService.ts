import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { appUsage } from "../entities/appUsage.ts";
import { BayControlService } from "./BayControlService.ts";

/**
 * How long a sample is kept.
 *
 * Long enough to answer "what was it doing before it got killed last night",
 * short enough that the table stays a few hundred thousand rows on a machine
 * hosting a handful of apps. Raw throughout — see {@link appUsage} for why
 * this is not rolled up.
 */
const RETENTION_DAYS = 14;

/**
 * Records what Bay's supervisor reports, once a minute, and reads it back.
 *
 * Sampled by bay-admin rather than kept by Bay, deliberately. Bay is the
 * orchestrator: it is restarted for every upgrade, and a series it held in
 * memory would restart with it. Here it lives in a database that survives, on
 * the machine that already owns the panel.
 */
export class AppUsageService {
  protected readonly log = $logger();
  protected readonly bay = $inject(BayControlService);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly usage = $repository(appUsage);

  /**
   * Takes one sample of every app Bay knows about.
   *
   * Returns how many rows were written so the caller can stay quiet when
   * nothing happened.
   */
  async sample(): Promise<number> {
    const apps = await this.bay.listApps();
    if (!apps.length) {
      return 0;
    }

    const at = this.dateTime.nowISOString();
    const rows = apps.map((app) => ({
      appKey: `${app.name}/${app.env}`,
      at,
      running: app.running ?? false,
      // Spread individually rather than `...app.usage`: the entity's shape is
      // this app's contract, and copying whatever Bay happened to send would
      // make a future field in the control API silently become a column here.
      memoryBytes: app.usage?.memoryBytes,
      cpuSeconds: app.usage?.cpuSeconds,
      tasks: app.usage?.tasks,
      restarts: app.usage?.restarts,
    }));

    await this.usage.createMany(rows);
    return rows.length;
  }

  /**
   * Drops samples past the retention window.
   *
   * Kept in this service rather than a separate job: a series with no pruning
   * is a disk that fills, and the two belong to the same decision.
   */
  async prune(): Promise<number> {
    const cutoff = this.dateTime
      .now()
      .subtract(RETENTION_DAYS, "days")
      .toISOString();
    const deleted = await this.usage.deleteMany({ at: { lt: cutoff } });
    return deleted.length;
  }

  /**
   * Reads one app's samples, oldest first.
   *
   * Bounded by a time window rather than a row count so the caller gets a
   * series with an honest shape: asking for "the last 200 points" of an app
   * that has been down returns a chart of last week labelled as now.
   */
  async series(appKey: string, hours: number): Promise<AppUsagePoint[]> {
    const since = this.dateTime.now().subtract(hours, "hours").toISOString();
    const rows = await this.usage.findMany({
      where: { appKey: { eq: appKey }, at: { gte: since } },
      orderBy: [{ column: "at", direction: "asc" }],
    });

    return this.withCpuRate(
      rows.map((row) => ({
        at: row.at,
        running: row.running,
        memoryBytes: row.memoryBytes,
        tasks: row.tasks,
        restarts: row.restarts,
        cpuSecondsRaw: row.cpuSeconds,
      })),
    );
  }

  /**
   * Turns the cumulative CPU counter into a per-interval percentage.
   *
   * Done on read, from the raw counter, because the counter is the honest
   * thing to store and a rate cannot be recovered from an average.
   *
   * An interval where the counter went DOWN is dropped rather than reported as
   * zero: that only happens when the unit restarted, and a restart is already
   * visible in `restarts`. Reporting 0% there would draw a dip that looks like
   * an idle minute instead of a process that died.
   */
  withCpuRate(points: AppUsagePoint[]): AppUsagePoint[] {
    return points.map((point, index) => {
      const previous = index > 0 ? points[index - 1] : undefined;
      if (
        !previous ||
        point.cpuSecondsRaw === undefined ||
        previous.cpuSecondsRaw === undefined ||
        point.cpuSecondsRaw < previous.cpuSecondsRaw
      ) {
        return point;
      }
      const elapsedSeconds =
        (new Date(point.at).getTime() - new Date(previous.at).getTime()) / 1000;
      if (elapsedSeconds <= 0) {
        return point;
      }
      const used = point.cpuSecondsRaw - previous.cpuSecondsRaw;
      return { ...point, cpuPercent: (used / elapsedSeconds) * 100 };
    });
  }
}

/**
 * One sample, as the API hands it out.
 */
export interface AppUsagePoint {
  at: string;
  running: boolean;
  memoryBytes?: number;
  tasks?: number;
  restarts?: number;
  /** Cumulative counter, present only while the rate is being computed. */
  cpuSecondsRaw?: number;
  /** Share of one core over the interval ending at this point. */
  cpuPercent?: number;
}
