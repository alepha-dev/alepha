import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { BadRequestError, ConflictError, NotFoundError } from "alepha/server";

import { type AppInstance, appInstances } from "../entities/appInstances.ts";
import { type Monitor, monitors } from "../entities/monitors.ts";
import { sigils } from "../entities/sigils.ts";
import { AppService } from "./AppService.ts";

/**
 * Who owns a monitor: one app copy, by `monitors.appInstanceId` (#Q3657).
 *
 * Monitors made before the link existed have none. {@link adopt} gives each
 * of them an owner, and runs whenever a project's monitors or apps are read,
 * so a project is migrated by its first visit rather than by a data migration
 * that would have to mint app copies in SQL.
 */
export class UptimeMonitorOwners {
  /**
   * The environment an app made for an orphaned monitor gets.
   */
  public static readonly ENV = "production";

  protected readonly log = $logger();
  protected readonly monitors = $repository(monitors);
  protected readonly instances = $repository(appInstances);
  protected readonly sigils = $repository(sigils);
  protected readonly apps = $inject(AppService);

  /**
   * The app copy `appInstanceId` names, refused when it is not one of the
   * project's.
   */
  public async ownerOf(
    projectId: number,
    appInstanceId: string,
  ): Promise<AppInstance> {
    const instance = await this.instances.findOne({
      where: { id: { eq: appInstanceId }, projectId: { eq: projectId } },
    });
    if (!instance) {
      throw new NotFoundError("App not found in this project");
    }
    return instance;
  }

  /**
   * Each copy's monitor, by copy id: its HTTP check when it has one, else
   * whichever it owns (the rule the web's `monitorOfInstance` follows).
   */
  public async ofCopies(
    appInstanceIds: string[],
  ): Promise<Map<string, { id: string; active: boolean }>> {
    const chosen = new Map<string, Monitor>();
    if (appInstanceIds.length > 0) {
      const rows = await this.monitors.findMany({
        where: { appInstanceId: { inArray: appInstanceIds } },
      });
      for (const row of rows) {
        if (!row.appInstanceId) continue;
        const held = chosen.get(row.appInstanceId);
        if (!held || (row.kind === "http" && held.kind !== "http")) {
          chosen.set(row.appInstanceId, row);
        }
      }
    }
    return new Map(
      [...chosen].map(([copy, row]) => [
        copy,
        { id: row.id, active: row.active },
      ]),
    );
  }

  /**
   * Refuses clearing a copy's address while its HTTP monitor is on (#Q3684):
   * the check would be left with nothing to request.
   */
  public async assertAddressCanClear(instance: AppInstance): Promise<void> {
    const on = await this.monitors.findOne({
      where: {
        appInstanceId: { eq: instance.id },
        kind: { eq: "http" },
        active: { eq: true },
      },
    });
    if (on) {
      throw new BadRequestError(
        "Turn Monitor off in this app's settings before clearing its address.",
      );
    }
  }

  /**
   * Points the copy's HTTP monitors at its address (#Q3684): the monitor
   * checks the address set in the app's settings, and follows it when it
   * changes. Nothing to do while the copy has no address.
   */
  public async followAddress(instance: AppInstance): Promise<void> {
    if (!instance.url) return;
    const checks = await this.monitors.findMany({
      where: { appInstanceId: { eq: instance.id }, kind: { eq: "http" } },
    });
    for (const monitor of checks) {
      if (monitor.target !== instance.url) {
        await this.monitors.updateById(monitor.id, { target: instance.url });
      }
    }
  }

  /**
   * Give every monitor of the project without an owner one: the copy whose
   * address an HTTP monitor checks, or else an app made for it, named after
   * the monitor. Returns how many it attached.
   */
  public async adopt(projectId: number): Promise<number> {
    const orphans = await this.monitors.findMany({
      where: {
        projectId: { eq: projectId },
        appInstanceId: { isNull: true },
      },
    });
    if (orphans.length === 0) return 0;

    const instances: AppInstance[] = await this.instances.findMany({
      where: { projectId: { eq: projectId } },
    });
    const addresses = await this.addressesOf(instances);

    for (const monitor of orphans) {
      const matched =
        monitor.kind === "http"
          ? instances.find(
              (instance) =>
                addresses.get(instance.id) ===
                UptimeMonitorOwners.comparable(monitor.target),
            )
          : undefined;
      const owner = matched ?? (await this.appFor(projectId, monitor));
      if (!matched) instances.push(owner);
      await this.monitors.updateById(monitor.id, { appInstanceId: owner.id });
    }
    this.log.info("attached monitors to their app", {
      projectId,
      monitors: orphans.length,
    });
    return orphans.length;
  }

  /**
   * A URL as two checks would compare it: case-folded, with no trailing
   * slash.
   */
  public static comparable(url: string): string {
    return url.trim().toLowerCase().replace(/\/+$/, "");
  }

  /**
   * Each copy's address, the way the app pages show it: the pinned URL, else
   * the host its sigil last reported from.
   */
  protected async addressesOf(
    instances: AppInstance[],
  ): Promise<Map<string, string>> {
    const sigilIds = instances.flatMap((row) =>
      row.sigilId ? [row.sigilId] : [],
    );
    const sigilRows = sigilIds.length
      ? await this.sigils.findMany({ where: { id: { inArray: sigilIds } } })
      : [];
    const hostnames = new Map(
      sigilRows.map((sigil) => [sigil.id, sigil.lastSeenHostname]),
    );
    const addresses = new Map<string, string>();
    for (const instance of instances) {
      const hostname = instance.sigilId
        ? hostnames.get(instance.sigilId)
        : undefined;
      const url = instance.url ?? (hostname ? `https://${hostname}` : null);
      if (url) addresses.set(instance.id, UptimeMonitorOwners.comparable(url));
    }
    return addresses;
  }

  /**
   * An app made for a monitor no copy matched, named after the monitor in
   * `production`, and given its address when it checks a URL.
   */
  protected async appFor(
    projectId: number,
    monitor: Monitor,
  ): Promise<AppInstance> {
    const base = UptimeMonitorOwners.appName(monitor.name);
    for (let attempt = 1; attempt <= 50; attempt++) {
      const suffix = attempt === 1 ? "" : `-${attempt}`;
      const app = `${base.slice(0, 40 - suffix.length)}${suffix}`;
      try {
        return await this.apps.create({
          projectId,
          app,
          env: UptimeMonitorOwners.ENV,
          ...(monitor.kind === "http" ? { url: monitor.target } : {}),
        });
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
      }
    }
    throw new ConflictError(`No free app name for monitor "${monitor.name}"`);
  }

  /**
   * A monitor's name as an app name: lowercase letters, digits and single
   * hyphens, starting and ending with a letter or digit.
   */
  public static appName(name: string): string {
    const slug = name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "");
    return slug || "monitor";
  }
}
