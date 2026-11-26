import { $inject, AlephaError } from "alepha";
import { $repository } from "alepha/orm";

import { hostEvents } from "../entities/hostEvents.ts";
import type { Host } from "../entities/hosts.ts";
import { projects } from "../entities/projects.ts";
import type { HostEventFrame } from "../schemas/hostEventFrameSchema.ts";
import { LoreDatabase } from "./LoreDatabase.ts";
import { ProjectEvents } from "./ProjectEvents.ts";

/**
 * The watched units of a host (#Q4422): the names Lore sends the machine,
 * and the project events their changes raise.
 *
 * Bay reads the units the host's `watchUnits` names and reports every change
 * of state as a `unit.changed` host event (`{ unit, from, to }`). Two of those
 * changes are worth telling a person about:
 *
 * - `host.unit_failed`: the unit went `failed`, or the machine no longer has
 *   it (`not-found`).
 * - `host.unit_recovered`: it is `active` again after one of those. A unit
 *   that goes `active` after a plain restart (a deploy) raises nothing, which
 *   is the point: only a failure since the last `active` makes it a recovery.
 *
 * The host event is stored first and deduplicated by its id, so a frame Bay
 * sends twice raises its project event once.
 */
export class HostUnitEvents {
  /**
   * What a unit name must look like: systemd's characters, never a flag.
   */
  public static readonly NAME = /^[A-Za-z0-9][A-Za-z0-9@._:\\-]{0,199}$/;

  /** The most units one host watches, the bound Bay applies too. */
  public static readonly MAX = 20;

  /** The states that make a unit failed, as `unit.changed` reports them. */
  public static readonly FAILED = ["failed", "not-found"];

  /** How far back a recovery looks for the failure it ends. */
  protected static readonly LOOKBACK = 100;

  protected readonly database = $inject(LoreDatabase);
  protected readonly projectEvents = $inject(ProjectEvents);
  protected readonly events = $repository(hostEvents);
  protected readonly projects = $repository(projects);

  /**
   * The names as Lore stores and sends them: trimmed, a `.service` suffix
   * when there is none (as `systemctl` reads a bare name), each once, at
   * most {@link MAX}. A name systemd would not accept is refused rather
   * than dropped, so a typo reaches the person who made it.
   */
  public static normalize(names: string[]): string[] {
    const out: string[] = [];
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      if (!HostUnitEvents.NAME.test(name)) {
        throw new AlephaError(`"${name}" is not a systemd unit name`);
      }
      const unit = name.includes(".") ? name : `${name}.service`;
      if (!out.includes(unit)) out.push(unit);
    }
    if (out.length > HostUnitEvents.MAX) {
      throw new AlephaError(
        `A host watches at most ${HostUnitEvents.MAX} units`,
      );
    }
    return out;
  }

  /**
   * Raises the project event a freshly stored `unit.changed` calls for, if
   * any. Called only for an event the store kept, never for a duplicate.
   */
  public async handle(host: Host, frame: HostEventFrame): Promise<void> {
    if (frame.kind !== "unit.changed" || !host.projectId) return;
    const unit = typeof frame.data?.unit === "string" ? frame.data.unit : "";
    const to = typeof frame.data?.to === "string" ? frame.data.to : "";
    if (!unit || !to) return;

    if (HostUnitEvents.FAILED.includes(to)) {
      await this.emit(host, "host.unit_failed", unit, to, frame.at);
      return;
    }
    if (to === "active" && (await this.failedSinceActive(host, unit, frame))) {
      await this.emit(host, "host.unit_recovered", unit, to, frame.at);
    }
  }

  /**
   * Whether the unit failed after it was last `active`, read from the host's
   * stored events, newest first, before this one.
   */
  protected async failedSinceActive(
    host: Host,
    unit: string,
    frame: HostEventFrame,
  ): Promise<boolean> {
    const earlier = await this.events.findMany({
      where: {
        hostId: { eq: host.id },
        kind: { eq: "unit.changed" },
        at: { lte: frame.at },
      },
      orderBy: [{ column: "at", direction: "desc" }],
      limit: HostUnitEvents.LOOKBACK,
    });
    for (const event of earlier) {
      if (event.eventId === frame.id) continue;
      const data = (event.data ?? {}) as Record<string, unknown>;
      if (data.unit !== unit) continue;
      const to = typeof data.to === "string" ? data.to : "";
      if (HostUnitEvents.FAILED.includes(to)) return true;
      if (to === "active") return false;
    }
    return false;
  }

  protected async emit(
    host: Host,
    name: "host.unit_failed" | "host.unit_recovered",
    unit: string,
    state: string,
    since: string,
  ): Promise<void> {
    const project = await this.projects.getById(host.projectId!);
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
        unit,
        state,
        since,
        url: `/${home}/hosts/${host.slug}`,
      },
    });
    await this.database.batch(recorded.statements);
    await recorded.committed();
  }
}
