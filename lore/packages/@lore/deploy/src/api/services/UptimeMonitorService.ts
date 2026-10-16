import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { monitorIncidents } from "../entities/monitorIncidents.ts";
import { type Monitor, monitors } from "../entities/monitors.ts";
import type { MonitorConfig } from "../schemas/monitorConfigSchema.ts";
import { UptimePushService } from "./UptimePushService.ts";

export class UptimeMonitorService {
  protected readonly monitors = $repository(monitors);
  protected readonly incidents = $repository(monitorIncidents);
  protected readonly pushes = $inject(UptimePushService);
  protected readonly clock = $inject(DateTimeProvider);

  public async create(
    projectId: number,
    config: MonitorConfig,
  ): Promise<{ monitor: Monitor; token?: string }> {
    const clean = {
      ...config,
      name: config.name.trim(),
      target: config.target.trim(),
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
    Object.assign(monitor, config, {
      name: config.name.trim(),
      target: monitor.kind === "push" ? "" : config.target.trim(),
    });
    await this.monitors.save(monitor);
    return monitor;
  }

  public async setActive(monitor: Monitor, active: boolean): Promise<Monitor> {
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
