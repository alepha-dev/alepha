import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import type { AppInstance } from "../entities/appInstances.ts";
import {
  type EstateCommand,
  estateCommands,
} from "../entities/estateCommands.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { type Estate, estates } from "../entities/estates.ts";
import type { StackEnvironment } from "../entities/stackEnvironments.ts";
import type { Stack } from "../entities/stacks.ts";
import { EstateCommandService } from "./EstateCommandService.ts";
import { EstateInventoryService } from "./EstateInventoryService.ts";

/**
 * Where a copy lives on a Bay, when it does: the estate, and the name the
 * machine knows it by.
 */
export type BayCopyTarget =
  | { status: "ok"; estate: Estate; machineApp: string }
  | {
      status: "no-estate" | "not-lent" | "not-bay" | "not-deployed";
      estate?: Estate;
    };

/**
 * Undeploying from a Bay estate (#Q3153, folio #F1455): asking the machine to
 * stop serving a copy, or a stack environment, and forget it.
 *
 * ## ⚠️ Never the data
 *
 * The `remove` and `stack-remove` verbs carry no purge, and this service has
 * no way to ask for one. A copy's database, uploads and `.env`, and a stack's
 * volumes, stay on the machine; deleting them is `bay remove --purge` (or
 * `bay stack destroy --purge`) run there, before the removal, by someone who
 * can reach the host. Both verbs are held to the estate's deploy switch, in
 * `EstateCommandService.assertAccepts` and again by Bay from its `welcome`.
 *
 * ## The name is the stored one
 *
 * A removal is aimed the way a backup is: at the name the copy was deployed
 * under, on the estate it was deployed to (`resourceName`,
 * `resourceEstateId`), never at a name the caller chose and never at one
 * recomputed from the project's current slug. A project can only remove what
 * it deployed.
 */
export class BayRemovalService {
  protected readonly estates = $repository(estates);
  protected readonly grants = $repository(estateProjects);
  protected readonly rows = $repository(estateCommands);
  protected readonly commands = $inject(EstateCommandService);
  protected readonly inventories = $inject(EstateInventoryService);

  /**
   * The Bay instance a copy is, checked the way `DeployGate` checks a deploy:
   * an estate, still there, still lent, a Bay, and a name the copy was
   * deployed under ON THAT estate.
   *
   * ⚠️ Reads the STORED name and never `ResourceNameService.resolve`, which
   * stores one: asking must not name a copy that never deployed.
   */
  public async target(instance: AppInstance): Promise<BayCopyTarget> {
    if (!instance.estateId) {
      return { status: "no-estate" };
    }
    const estate = await this.estates.findById(instance.estateId);
    if (!estate) {
      return { status: "no-estate" };
    }
    const grant = await this.grants.findOne({
      where: {
        estateId: { eq: estate.id },
        projectId: { eq: instance.projectId },
      },
    });
    if (!grant) {
      return { status: "not-lent" };
    }
    if (estate.type !== "bay") {
      return { status: "not-bay", estate };
    }
    const suffix = `-${instance.env}`;
    const name = instance.resourceName;
    // ⚠️ The name is only this copy's on the estate it was deployed to under
    // it. Moved since, the same name on the new estate may be another
    // project's instance.
    if (
      instance.resourceEstateId !== estate.id ||
      !name?.endsWith(suffix) ||
      name.length <= suffix.length
    ) {
      return { status: "not-deployed", estate };
    }
    return { status: "ok", estate, machineApp: name.slice(0, -suffix.length) };
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
    const inventory = await this.inventories.findFor(target.estate.id);
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
  ): Promise<{ command: EstateCommand; estate: Estate; machineApp: string }> {
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
      target.estate,
      {
        kind: "remove",
        payload: { app: target.machineApp, environment: instance.env },
      },
      requestedBy,
    );
    return { command, estate: target.estate, machineApp: target.machineApp };
  }

  /**
   * A copy's own removal command, scoped on the estate AND the copy's machine
   * name, so a project cannot read another project's commands on a shared
   * machine by guessing ids.
   */
  public async readCopyRemoval(
    instance: AppInstance,
    commandId: string,
  ): Promise<EstateCommand> {
    const target = await this.target(instance);
    const command =
      target.status === "ok"
        ? await this.rows.findOne({
            where: {
              id: { eq: commandId },
              estateId: { eq: target.estate.id },
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
  ): Promise<{ command: EstateCommand; estate: Estate } | undefined> {
    if (!environment.revision) {
      return undefined;
    }
    const estate = await this.stackEstate(stack, environment);
    const command = await this.commands.enqueue(
      estate,
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
    return { command, estate };
  }

  /**
   * A stack environment's own removal command, scoped like a copy's.
   */
  public async readStackRemoval(
    stack: Stack,
    environment: StackEnvironment,
    commandId: string,
  ): Promise<EstateCommand> {
    const estateId = environment.estateId ?? stack.estateId;
    const command = estateId
      ? await this.rows.findOne({
          where: { id: { eq: commandId }, estateId: { eq: estateId } },
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

  protected async stackEstate(
    stack: Stack,
    environment: StackEnvironment,
  ): Promise<Estate> {
    const estateId = environment.estateId ?? stack.estateId;
    const estate = estateId ? await this.estates.findById(estateId) : undefined;
    const grant = estate
      ? await this.grants.findOne({
          where: {
            estateId: { eq: estate.id },
            projectId: { eq: stack.projectId },
          },
        })
      : undefined;
    if (!estate || !grant || estate.type !== "bay") {
      throw new BadRequestError(
        `${stack.name}/${environment.env} runs on no Bay lent to this project, so Lore has no machine to ask.`,
      );
    }
    return estate;
  }
}
