import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import type { AppInstance } from "../entities/appInstances.ts";
import { type HostCommand, hostCommands } from "../entities/hostCommands.ts";
import { hostProjects } from "../entities/hostProjects.ts";
import { type Host, hosts } from "../entities/hosts.ts";
import type { StackEnvironment } from "../entities/stackEnvironments.ts";
import type { Stack } from "../entities/stacks.ts";
import { HostCommandService } from "./HostCommandService.ts";
import { HostInventoryService } from "./HostInventoryService.ts";

/**
 * Where a copy lives on a Bay, when it does: the host, and the name the
 * machine knows it by.
 */
export type BayCopyTarget =
  | { status: "ok"; host: Host; machineApp: string }
  | {
      status: "no-host" | "not-lent" | "not-bay" | "not-deployed";
      host?: Host;
    };

/**
 * Undeploying from a Bay host (#Q3153, folio #F1455): asking the machine to
 * stop serving a copy, or a stack environment, and forget it.
 *
 * ## ⚠️ Never the data
 *
 * The `remove` and `stack-remove` verbs carry no purge, and this service has
 * no way to ask for one. A copy's database, uploads and `.env`, and a stack's
 * volumes, stay on the machine; deleting them is `bay remove --purge` (or
 * `bay stack destroy --purge`) run there, before the removal, by someone who
 * can reach the host. Both verbs are held to the host's deploy switch, in
 * `HostCommandService.assertAccepts` and again by Bay from its `welcome`.
 *
 * ## The name is the stored one
 *
 * A removal is aimed the way a backup is: at the name the copy was deployed
 * under, on the host it was deployed to (`resourceName`,
 * `resourceHostId`), never at a name the caller chose and never at one
 * recomputed from the project's current slug. A project can only remove what
 * it deployed.
 */
export class BayRemovalService {
  protected readonly hosts = $repository(hosts);
  protected readonly grants = $repository(hostProjects);
  protected readonly rows = $repository(hostCommands);
  protected readonly commands = $inject(HostCommandService);
  protected readonly inventories = $inject(HostInventoryService);

  /**
   * The Bay instance a copy is, checked the way `DeployGate` checks a deploy:
   * a host, still there, still lent, a Bay, and a name the copy was
   * deployed under ON THAT host.
   *
   * ⚠️ Reads the STORED name and never `ResourceNameService.resolve`, which
   * stores one: asking must not name a copy that never deployed.
   */
  public async target(instance: AppInstance): Promise<BayCopyTarget> {
    if (!instance.hostId) {
      return { status: "no-host" };
    }
    const host = await this.hosts.findById(instance.hostId);
    if (!host) {
      return { status: "no-host" };
    }
    const grant = await this.grants.findOne({
      where: {
        hostId: { eq: host.id },
        projectId: { eq: instance.projectId },
      },
    });
    if (!grant) {
      return { status: "not-lent" };
    }
    if (host.type !== "bay") {
      return { status: "not-bay", host };
    }
    const suffix = `-${instance.env}`;
    const name = instance.resourceName;
    // ⚠️ The name is only this copy's on the host it was deployed to under
    // it. Moved since, the same name on the new host may be another
    // project's instance.
    if (
      instance.resourceHostId !== host.id ||
      !name?.endsWith(suffix) ||
      name.length <= suffix.length
    ) {
      return { status: "not-deployed", host };
    }
    return { status: "ok", host, machineApp: name.slice(0, -suffix.length) };
  }

  /**
   * Whether a copy still runs on its Bay, as far as Lore can tell.
   *
   * The machine's last inventory is the answer when there is one: a removal
   * that ran pushes a fresh one without the copy. With no inventory yet, a
   * copy deployed under a stored name is taken to be there, since "still
   * deployed" is the safe reading for a check that guards forgetting it.
   */
  public async stillDeployed(instance: AppInstance): Promise<boolean> {
    if (instance.stackEnvironmentId) {
      // A member goes with its stack environment, never on its own.
      return false;
    }
    const target = await this.target(instance);
    if (target.status !== "ok") {
      return false;
    }
    const inventory = await this.inventories.findFor(target.host.id);
    if (!inventory) {
      return true;
    }
    return inventory.apps.some(
      (app) => app.app === target.machineApp && app.env === instance.env,
    );
  }

  /**
   * Queue the removal of a copy from its Bay, data kept.
   */
  public async removeCopy(
    instance: AppInstance,
    requestedBy?: string,
  ): Promise<{ command: HostCommand; host: Host; machineApp: string }> {
    if (instance.stackEnvironmentId) {
      throw new BadRequestError(
        `${instance.app}/${instance.env} is a member of a stack: it is removed with its stack environment (\`lore stack destroy\`), never on its own.`,
      );
    }
    const target = await this.target(instance);
    if (target.status !== "ok") {
      throw new BadRequestError(
        target.status === "not-deployed"
          ? `${instance.app}/${instance.env} has not been deployed to its Bay, so there is nothing on the machine to remove.`
          : `${instance.app}/${instance.env} runs on no Bay lent to this project, so Lore has no machine to ask.`,
      );
    }
    const command = await this.commands.enqueue(
      target.host,
      {
        kind: "remove",
        payload: { app: target.machineApp, environment: instance.env },
      },
      requestedBy,
    );
    return { command, host: target.host, machineApp: target.machineApp };
  }

  /**
   * A copy's own removal command, scoped on the host AND the copy's machine
   * name, so a project cannot read another project's commands on a shared
   * machine by guessing ids.
   */
  public async readCopyRemoval(
    instance: AppInstance,
    commandId: string,
  ): Promise<HostCommand> {
    const target = await this.target(instance);
    const command =
      target.status === "ok"
        ? await this.rows.findOne({
            where: {
              id: { eq: commandId },
              hostId: { eq: target.host.id },
            },
          })
        : undefined;
    if (
      !command ||
      target.status !== "ok" ||
      command.kind !== "remove" ||
      command.payload.app !== target.machineApp ||
      command.payload.environment !== instance.env
    ) {
      throw new NotFoundError("No such removal for this app");
    }
    return command;
  }

  /**
   * Queue the removal of a stack environment from its Bay, volumes kept.
   *
   * @returns undefined when the environment was never deployed: there is
   * nothing on a machine to remove, and forgetting it in Lore is the whole job.
   */
  public async removeStackEnvironment(
    stack: Stack,
    environment: StackEnvironment,
    requestedBy?: string,
  ): Promise<{ command: HostCommand; host: Host } | undefined> {
    if (!environment.revision) {
      return undefined;
    }
    const host = await this.stackHost(stack, environment);
    const command = await this.commands.enqueue(
      host,
      {
        kind: "stack-remove",
        payload: {
          app: "",
          environment: environment.env,
          stack: stack.name,
        },
      },
      requestedBy,
    );
    return { command, host };
  }

  /**
   * A stack environment's own removal command, scoped like a copy's.
   */
  public async readStackRemoval(
    stack: Stack,
    environment: StackEnvironment,
    commandId: string,
  ): Promise<HostCommand> {
    const hostId = environment.hostId ?? stack.hostId;
    const command = hostId
      ? await this.rows.findOne({
          where: { id: { eq: commandId }, hostId: { eq: hostId } },
        })
      : undefined;
    if (
      !command ||
      command.kind !== "stack-remove" ||
      command.payload.stack !== stack.name ||
      command.payload.environment !== environment.env
    ) {
      throw new NotFoundError("No such removal for this stack environment");
    }
    return command;
  }

  protected async stackHost(
    stack: Stack,
    environment: StackEnvironment,
  ): Promise<Host> {
    const hostId = environment.hostId ?? stack.hostId;
    const host = hostId ? await this.hosts.findById(hostId) : undefined;
    const grant = host
      ? await this.grants.findOne({
          where: {
            hostId: { eq: host.id },
            projectId: { eq: stack.projectId },
          },
        })
      : undefined;
    if (!host || !grant || host.type !== "bay") {
      throw new BadRequestError(
        `${stack.name}/${environment.env} runs on no Bay lent to this project, so Lore has no machine to ask.`,
      );
    }
    return host;
  }
}
