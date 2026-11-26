import { hostInventories, hosts } from "@lore/core/schemas";
import { $repository } from "alepha/orm";

import type { Monitor } from "../entities/monitors.ts";

/**
 * Whether a monitor's failed check is held (#Q4424): its app is restarting on
 * purpose, so the failure is expected and must not page anyone.
 *
 * A monitor names a host of its project, by slug, and one of the units that
 * host watches (`graceHost`, `graceUnit`). The host's Bay reports every change of those
 * units on its inventory, so the last inventory says whether the unit is
 * starting or stopping right now. A check that fails while it is, within
 * `graceSecs` of when that began, is held: the app under it is coming back,
 * as it does on every deploy.
 *
 * Past the grace the unit is stuck, and a failure counts again: a start that
 * never ends is an outage, not a deploy.
 */
export class UptimeGrace {
  /** The unit states that mean "on purpose, on its way": a restart. */
  public static readonly MOVING = ["activating", "deactivating", "reloading"];

  protected readonly inventories = $repository(hostInventories);
  protected readonly hosts = $repository(hosts);

  /**
   * The reason a failure is held, or undefined when it counts. Read only
   * for a failed check of a monitor that names a unit, so a healthy monitor
   * costs no query.
   */
  public async heldBy(
    monitor: Monitor,
    checkedAt: number,
  ): Promise<string | undefined> {
    if (!monitor.graceHost || !monitor.graceUnit) return undefined;
    const host = await this.hosts.findOne({
      where: {
        projectId: { eq: monitor.projectId },
        slug: { eq: monitor.graceHost },
      },
    });
    if (!host) return undefined;
    const inventory = await this.inventories.findOne({
      where: { hostId: { eq: host.id } },
    });
    // A bare name is a `.service`, as Bay and `systemctl` read it.
    const wanted = monitor.graceUnit.includes(".")
      ? monitor.graceUnit
      : `${monitor.graceUnit}.service`;
    const unit = inventory?.machine?.units?.find((it) => it.name === wanted);
    if (!unit || !UptimeGrace.MOVING.includes(unit.activeState)) {
      return undefined;
    }
    if (unit.since) {
      const began = Date.parse(unit.since);
      if (
        Number.isFinite(began) &&
        checkedAt - began > monitor.graceSecs * 1000
      ) {
        return undefined;
      }
    }
    return `held: ${unit.name} is ${unit.activeState}${unit.since ? ` since ${unit.since}` : ""}`;
  }
}
