import { projectCapabilities } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { DeployAnalytics } from "../entities/deployAnalytics.ts";
import { monitorHeartbeats } from "../entities/monitorHeartbeats.ts";
import { type Monitor, monitors } from "../entities/monitors.ts";
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
  protected readonly capabilities = $repository(projectCapabilities);
  protected readonly analytics = $inject(DeployAnalytics);
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
        where: { key: "apps" },
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
                await this.analytics.probes.record({
                  monitorId: monitor.id,
                  result: result.result,
                  prober: "local",
                  count: 1,
                  up: result.ok ? 1 : 0,
                  latencyMs: result.ok ? result.latencyMs : 0,
                });
                await this.beats.create({
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
    },
  });

  /**
   * Transition outputs join here, without touching the probe loop.
   */
  protected async transition(_transition: UptimeTransition): Promise<void> {}
}
