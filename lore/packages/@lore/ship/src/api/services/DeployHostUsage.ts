import { HostUsageRegistry } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { appInstances } from "../entities/appInstances.ts";
import { stackEnvironments } from "../entities/stackEnvironments.ts";
import { stacks } from "../entities/stacks.ts";

/**
 * What Ship deploys to a host, told to core's `HostUsageRegistry` (#E166,
 * #Q4098): the copies and stacks that name it, which refuse its delete or a
 * detach, and the copies its inventory reconciles against what the machine
 * reports. Nothing injects it: `LoreShipApi` lists it.
 */
export class DeployHostUsage {
  protected readonly usage = $inject(HostUsageRegistry);
  protected readonly instances = $repository(appInstances);
  protected readonly stacks = $repository(stacks);
  protected readonly stackEnvironments = $repository(stackEnvironments);
  protected readonly projects = $repository(projects);

  constructor() {
    this.usage.registerReferences((hostId, projectId) =>
      this.references(hostId, projectId),
    );
    this.usage.registerTrackedApps((hostId) =>
      this.instances.findMany({
        where: { hostId: { eq: hostId } },
        columns: ["id", "app", "env", "projectId"],
      }),
    );
  }

  /**
   * The copies (`app/env`) and stacks deploying to a host, scoped to one
   * project for a detach. A deleted project's rows are not counted.
   */
  async references(hostId: string, projectId?: number): Promise<string[]> {
    const referencing = await this.instances.findMany({
      where: {
        hostId: { eq: hostId },
        ...(projectId === undefined ? {} : { projectId: { eq: projectId } }),
      },
      columns: ["app", "env", "projectId"],
      orderBy: [
        { column: "app", direction: "asc" },
        { column: "env", direction: "asc" },
      ],
    });
    // A deleted project deploys nothing (#Q3169): its copies do not hold the
    // host, even those left from before its deletion freed them.
    const live = await this.liveProjects(
      referencing.map((instance) => instance.projectId),
    );
    return [
      ...referencing
        .filter((instance) => live.has(instance.projectId))
        .map((instance) => `${instance.app}/${instance.env}`),
      ...(await this.stacksReferencing(hostId, projectId)),
    ];
  }

  /**
   * Which of these projects still exist: the repository leaves out a
   * soft-deleted row, so a project its owner deleted is not among them.
   */
  protected async liveProjects(ids: number[]): Promise<Set<number>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      return new Set();
    }
    const rows = await this.projects.findMany({
      where: { id: { inArray: unique } },
      columns: ["id"],
    });
    return new Set(rows.map((row) => row.id));
  }

  /**
   * The stacks and stack environments that deploy to a host, named as
   * `stack (stack)` for a stack's default host and `stack/env (stack)` for
   * an environment's own override (#Q3131).
   *
   * Both columns are `set null` at the database for the reason
   * `app_instances.hostId` is: without this, deleting a host silently
   * left a stack with nowhere to deploy. With a `projectId`, only that
   * project's stacks count, as for instances.
   */
  protected async stacksReferencing(
    hostId: string,
    projectId?: number,
  ): Promise<string[]> {
    const scope =
      projectId === undefined ? {} : { projectId: { eq: projectId } };
    const allDefaults = await this.stacks.findMany({
      where: { hostId: { eq: hostId }, ...scope },
      columns: ["name", "projectId"],
      orderBy: [{ column: "name", direction: "asc" }],
    });
    const liveDefaults = await this.liveProjects(
      allDefaults.map((stack) => stack.projectId),
    );
    const defaults = allDefaults.filter((stack) =>
      liveDefaults.has(stack.projectId),
    );
    const overrides = await this.stackEnvironments.findMany({
      where: { hostId: { eq: hostId } },
      columns: ["stackId", "env"],
      orderBy: [{ column: "env", direction: "asc" }],
    });
    const owners = overrides.length
      ? await this.stacks.findMany({
          where: {
            id: { inArray: [...new Set(overrides.map((row) => row.stackId))] },
            ...scope,
          },
          columns: ["id", "name", "projectId"],
        })
      : [];
    const liveOwners = await this.liveProjects(
      owners.map((stack) => stack.projectId),
    );
    const nameOf = new Map(
      owners
        .filter((stack) => liveOwners.has(stack.projectId))
        .map((stack) => [stack.id, stack.name]),
    );
    return [
      ...defaults.map((stack) => `${stack.name} (stack)`),
      ...overrides
        .filter((row) => nameOf.has(row.stackId))
        .map((row) => `${nameOf.get(row.stackId)}/${row.env} (stack)`)
        .sort(),
    ];
  }
}
