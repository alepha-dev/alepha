import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { monitorIncidents } from "../entities/monitorIncidents.ts";
import { type Monitor, monitors } from "../entities/monitors.ts";
import type { MonitorConfig } from "../schemas/monitorConfigSchema.ts";
import { UptimePushService } from "./UptimePushService.ts";
import { UptimeSocketProber } from "./UptimeSocketProber.ts";

export class UptimeMonitorService {
  protected readonly monitors = $repository(monitors);
  protected readonly incidents = $repository(monitorIncidents);
  protected readonly pushes = $inject(UptimePushService);
  protected readonly clock = $inject(DateTimeProvider);
  protected readonly sockets = $inject(UptimeSocketProber);

  /**
   * A `tcp` or `cert` monitor where the runtime has no sockets (Workers)
   * would fail every check and open an outage (#Q4431): refuse it instead.
   */
  protected assertRunnable(kind: Monitor["kind"]): void {
    if ((kind === "tcp" || kind === "cert") && !this.sockets.available())
      throw new BadRequestError(this.sockets.unavailableReason);
  }

  /**
   * ⚠️ `appInstanceId` is optional here only for the specs and the adoption
   * of monitors made before the link (#Q3657). Every surface a person or an
   * agent creates through, the API, MCP and the CLI, requires it.
   */
  public async create(
    projectId: number,
    config: MonitorConfig,
    owner: { appInstanceId?: string } = {},
  ): Promise<{ monitor: Monitor; token?: string }> {
    this.assertRunnable(config.kind);
    const clean = {
      ...config,
      name: config.name.trim(),
      target: config.target.trim(),
      ...(owner.appInstanceId ? { appInstanceId: owner.appInstanceId } : {}),
    };
    if (config.kind === "push") return this.pushes.create(projectId, clean);
    const now = this.clock.nowISOString();
    const monitor = await this.monitors.create({
      ...clean,
      projectId,
      statusSince: now,
      nextCheckAt: now,
    });
    return { monitor };
  }

  public async update(
    monitor: Monitor,
    config: MonitorConfig,
  ): Promise<Monitor> {
    // A new kind is a new series and, for push, a different credential model.
    if (monitor.kind !== config.kind)
      throw new BadRequestError("Create a new monitor to change its kind");
    this.assertRunnable(monitor.kind);
    Object.assign(monitor, config, {
      name: config.name.trim(),
      target: monitor.kind === "push" ? "" : config.target.trim(),
    });
    await this.monitors.save(monitor);
    return monitor;
  }

  public async setActive(monitor: Monitor, active: boolean): Promise<Monitor> {
    // Resuming one made before the refusal would fail every check again.
    if (active) this.assertRunnable(monitor.kind);
    if (monitor.active === active) return monitor;
    const open = active
      ? await this.incidents.findOne({
          where: { monitorId: monitor.id, endedAt: { isNull: true } },
        })
      : undefined;
    monitor.active = active;
    monitor.status = active ? (open ? "down" : "pending") : "paused";
    monitor.statusSince =
      active && open ? open.startedAt : this.clock.nowISOString();
    monitor.failures = 0;
    monitor.nextCheckAt = this.clock.nowISOString();
    await this.monitors.save(monitor);
    return monitor;
  }
}
