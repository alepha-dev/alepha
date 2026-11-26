import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { type Host, hosts } from "../entities/hosts.ts";
import { projects } from "../entities/projects.ts";
import type { HostStatsFrame } from "../schemas/hostStatsFrameSchema.ts";
import { LoreDatabase } from "./LoreDatabase.ts";
import { ProjectEvents } from "./ProjectEvents.ts";

/**
 * Disk and memory thresholds per host (#Q4423).
 *
 * A host may set `alertDiskPercent` and `alertMemoryPercent`. A stats reading
 * at or above one raises `host.resource_high` once; the alert then stays
 * raised, on the row (`resourceAlerts`), until a reading falls
 * {@link HYSTERESIS} points under the limit, which raises `host.resource_ok`.
 * The margin keeps a disk hovering at the limit from paging every half hour.
 *
 * Kept on the row rather than in memory, so a restart of Lore neither repeats
 * an alert nor forgets one.
 */
export class HostResourceAlerts {
  /** Points under the limit a reading must fall to clear the alert. */
  public static readonly HYSTERESIS = 5;

  protected readonly database = $inject(LoreDatabase);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly projectEvents = $inject(ProjectEvents);
  protected readonly hosts = $repository(hosts);
  protected readonly projects = $repository(projects);

  /**
   * Compares one reading with the host's limits, raising and clearing.
   * Takes the row the socket loaded for this frame.
   */
  public async check(host: Host, frame: HostStatsFrame): Promise<void> {
    const readings = {
      disk: { value: frame.diskPercent, limit: host.alertDiskPercent },
      memory: { value: frame.memoryPercent, limit: host.alertMemoryPercent },
    };
    const alerts = { ...host.resourceAlerts };
    let changed = false;
    for (const resource of ["disk", "memory"] as const) {
      const { value, limit } = readings[resource];
      const raised = alerts[resource];
      if (limit === undefined || limit === null) {
        // The limit was removed: forget the alert quietly.
        if (raised) {
          delete alerts[resource];
          changed = true;
        }
        continue;
      }
      if (value === undefined) continue;
      if (!raised && value >= limit) {
        const since = this.dateTime.nowISOString();
        alerts[resource] = since;
        changed = true;
        await this.emit(
          host,
          "host.resource_high",
          resource,
          value,
          limit,
          since,
        );
      } else if (raised && value < limit - HostResourceAlerts.HYSTERESIS) {
        delete alerts[resource];
        changed = true;
        await this.emit(
          host,
          "host.resource_ok",
          resource,
          value,
          limit,
          raised,
        );
      }
    }
    if (changed) {
      await this.hosts.updateById(host.id, { resourceAlerts: alerts });
    }
  }

  protected async emit(
    host: Host,
    name: "host.resource_high" | "host.resource_ok",
    resource: "disk" | "memory",
    percent: number,
    limit: number,
    since: string,
  ): Promise<void> {
    const project = await this.projects.getById(host.projectId);
    const home = project.slug || `project-${project.id}`;
    const recorded = await this.projectEvents.emit({
      projectId: project.id,
      name,
      subjectId: host.id,
      fields: {
        project: project.title,
        title: host.slug,
        host_id: host.id,
        host: host.slug,
        resource,
        percent: Math.round(percent),
        limit,
        since,
        url: `/${home}/hosts/${host.slug}`,
      },
    });
    await this.database.batch(recorded.statements);
    await recorded.committed();
  }
}
