import { projectCapabilities } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { DeployAnalytics } from "../entities/deployAnalytics.ts";
import { monitorHeartbeats } from "../entities/monitorHeartbeats.ts";
import {
  type MonitorIncident,
  monitorIncidents,
} from "../entities/monitorIncidents.ts";
import { type Monitor, monitors } from "../entities/monitors.ts";
import { UptimeActivityService } from "../services/UptimeActivityService.ts";
import { UptimeErrorService } from "../services/UptimeErrorService.ts";
import { UptimeProber } from "../services/UptimeProber.ts";
import {
  UptimeStateService,
  type UptimeTransition,
} from "../services/UptimeStateService.ts";

/**
 * One locked minute tick. Workers take the next target as soon as they are
 * free, so one slow target does not hold a whole batch behind it.
 */
export class UptimeJobs {
  protected readonly monitors = $repository(monitors);
  protected readonly beats = $repository(monitorHeartbeats);
  protected readonly incidents = $repository(monitorIncidents);
  protected readonly capabilities = $repository(projectCapabilities);
  protected readonly analytics = $inject(DeployAnalytics);
  protected readonly projectErrors = $inject(UptimeErrorService);
  protected readonly activity = $inject(UptimeActivityService);
  protected readonly prober = $inject(UptimeProber);
  protected readonly state = $inject(UptimeStateService);
  protected readonly clock = $inject(DateTimeProvider);
  protected readonly log = $logger();
  protected readonly concurrency = 10;

  public readonly tick = $job({
    name: "uptime.tick",
    description:
      "Checks due uptime monitors and reconciles their outage state.",
    cron: "* * * * *",
    lock: true,
    timeout: [2, "minutes"],
    handler: async () => {
      const started = this.clock.nowMillis();
      const enabled = await this.capabilities.findMany({
        where: { key: "ship" },
      });
      const projects = enabled
        .filter((row) => row.options.uptime === true)
        .map((row) => row.projectId);
      const due: Monitor[] = [];
      // Each project id is a D1 parameter, so select in bounded batches.
      for (let index = 0; index < projects.length; index += 90) {
        due.push(
          ...(await this.monitors.findMany({
            where: {
              active: true,
              nextCheckAt: { lte: new Date(started).toISOString() },
              projectId: { inArray: projects.slice(index, index + 90) },
            },
            orderBy: [{ column: "nextCheckAt", direction: "asc" }],
          })),
        );
      }
      if (due.length === 0) return;
      // One read for every due monitor's open incident, not one per probe
      // (#Q3749): a monitor that was up and stays up then costs nothing more.
      const open = new Map<string, MonitorIncident>();
      for (let index = 0; index < due.length; index += 90) {
        const rows = await this.incidents.findMany({
          where: {
            monitorId: {
              inArray: due.slice(index, index + 90).map((row) => row.id),
            },
            endedAt: { isNull: true },
          },
        });
        for (const row of rows) open.set(row.monitorId, row);
      }
      // Written once at the end of the tick rather than per probe (#Q3749).
      const beats: Parameters<UptimeJobs["beats"]["createMany"]>[0] = [];
      const probes: Parameters<
        UptimeJobs["analytics"]["probes"]["recordMany"]
      >[0] = [];
      let cursor = 0;
      await Promise.all(
        Array.from(
          { length: Math.min(this.concurrency, due.length) },
          async () => {
            while (cursor < due.length) {
              const monitor = due[cursor++];
              if (!monitor) break;
              // Admit a probe only while its whole timeout fits in this tick.
              // Over-capacity targets stay due and keep their place next minute.
              if (
                this.clock.nowMillis() + monitor.timeoutSecs * 1000 >
                started + 50_000
              )
                break;
              try {
                const result = await this.prober.probe(monitor);
                const checkedAt = this.clock.nowMillis();
                probes.push({
                  monitorId: monitor.id,
                  result: result.result,
                  prober: "local",
                  count: 1,
                  up: result.ok ? 1 : 0,
                  latencyMs: result.ok ? result.latencyMs : 0,
                });
                beats.push({
                  monitorId: monitor.id,
                  at: new Date(checkedAt).toISOString(),
                  ok: result.ok,
                  latencyMs: result.latencyMs,
                  error: result.error,
                });
                const transitions = await this.state.apply(
                  monitor,
                  result,
                  checkedAt,
                  open.get(monitor.id) ?? null,
                );
                for (const transition of transitions)
                  await this.transition(transition);
              } catch (error) {
                this.log.error(
                  `Uptime check could not be persisted for monitor ${monitor.id}`,
                  error,
                );
              }
            }
          },
        ),
      );
      if (beats.length === 0) return;
      try {
        await this.beats.createMany(beats);
      } catch (error) {
        this.log.error("Uptime heartbeats could not be written", error);
      }
      try {
        await this.analytics.probes.recordMany(probes);
      } catch (error) {
        this.log.error("Uptime probe totals could not be recorded", error);
      }
    },
  });

  /**
   * Transition outputs join here, without touching the probe loop.
   */
  protected async transition(transition: UptimeTransition): Promise<void> {
    try {
      await this.projectErrors.handle(transition);
    } catch (error) {
      this.log.error(
        `Uptime error could not be written for incident ${transition.incident.id}`,
        error,
      );
    }
    // Alerts are automations since #Q3612: the incident's write recorded
    // `monitor.down` / `monitor.up` (#Q3610), and the Uptime bells' rules
    // notify from there.
    try {
      await this.activity.handle(transition);
    } catch (error) {
      this.log.error(
        `Uptime activity could not be written for incident ${transition.incident.id}`,
        error,
      );
    }
  }
}
