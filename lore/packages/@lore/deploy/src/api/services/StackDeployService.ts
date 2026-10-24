import { projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import type { EstateCommand } from "../entities/estateCommands.ts";
import { estateCommands } from "../entities/estateCommands.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { estates } from "../entities/estates.ts";
import {
  type StackDeployment,
  stackDeployments,
} from "../entities/stackDeployments.ts";
import { stackEnvironments } from "../entities/stackEnvironments.ts";
import { stackRevisions } from "../entities/stackRevisions.ts";
import type { StackDeployOutcome } from "../schemas/stackDeployOutcomeSchema.ts";
import type { StackModel } from "../schemas/stackModelSchema.ts";
import { ArtifactService } from "./ArtifactService.ts";
import { EstateCommandService } from "./EstateCommandService.ts";
import type { RegistryCredential } from "./ImageRegistryClient.ts";
import { RegistryCredentialService } from "./RegistryCredentialService.ts";
import { StackService } from "./StackService.ts";
import { StackTargets } from "./StackTargets.ts";
import { StackVariableService } from "./StackVariableService.ts";

/**
 * Deploying a stack environment: one `stack-deploy` command queued to its
 * estate, recorded as a `stack_deployments` row, and the machine-facing
 * answers that command needs (the bundle, the variables, the registry
 * credentials) resolved from that row and nothing else.
 *
 * ## Everything is checked before anything is queued
 *
 * The estate (the environment's own, else the stack's default) must be lent
 * to the project, run stacks, and accept deploys: the same message as an app
 * deploy when it does not, and Bay refuses on its side too. The revision must
 * run on the estate's target and every variable it needs must be set.
 *
 * ## A rollback is a deploy of an earlier revision
 *
 * Lore sends the earlier bundle again rather than naming the machine's own
 * revision number: the two numberings differ, and the bundle is what Lore
 * holds. The images resolve again on the machine; the digests the earlier
 * deploy pinned are on its revision row for the record.
 */
export class StackDeployService {
  protected readonly rows = $repository(stackDeployments);
  protected readonly commands = $repository(estateCommands);
  protected readonly environments = $repository(stackEnvironments);
  protected readonly revisions = $repository(stackRevisions);
  protected readonly estates = $repository(estates);
  protected readonly grants = $repository(estateProjects);
  protected readonly projects = $repository(projects);
  protected readonly stacks = $inject(StackService);
  protected readonly variables = $inject(StackVariableService);
  protected readonly registries = $inject(RegistryCredentialService);
  protected readonly targets = $inject(StackTargets);
  protected readonly queue = $inject(EstateCommandService);

  async deploy(input: {
    projectId: number;
    stackId: string;
    environmentId: string;
    revision?: number;
    createdBy?: string;
  }): Promise<StackDeployment> {
    const stack = await this.stacks.get(input.projectId, input.stackId);
    const environment = await this.stacks.getEnvironment(
      stack,
      input.environmentId,
    );
    const where = `${stack.name}/${environment.env}`;

    const estateId = this.stacks.estateOf(stack, environment);
    if (!estateId) {
      throw new BadRequestError(
        `${where} has no estate, so there is nowhere to deploy it. Choose one on the stack's Settings.`,
      );
    }
    const estate = await this.estates.findById(estateId);
    const grant = estate
      ? await this.grants.findOne({
          where: {
            estateId: { eq: estate.id },
            projectId: { eq: stack.projectId },
          },
        })
      : undefined;
    if (!estate || !grant) {
      throw new NotFoundError(
        `The estate ${where} deploys to is no longer lent to this project. Ask its owner to lend it again.`,
      );
    }
    if (estate.type !== "bay") {
      throw new BadRequestError(
        `The estate '${estate.slug}' is a ${estate.type} estate, and only a Bay runs stacks today.`,
      );
    }
    if (!estate.deployAllowed) {
      throw new BadRequestError(
        `The estate '${estate.slug}' does not accept deploys. Its owner can turn that on from their Estates page.`,
      );
    }

    const revisions = await this.stacks.revisionsOf(stack);
    const revision =
      input.revision === undefined
        ? revisions[0]
        : revisions.find((r) => r.number === input.revision);
    if (!revision) {
      throw new NotFoundError(
        input.revision === undefined
          ? `${stack.name} has no revision yet: upload a compose file first`
          : `${stack.name} has no revision ${input.revision}`,
      );
    }
    const model = JSON.parse(revision.model) as StackModel;
    this.targets.assert(model, [estate.type]);
    await this.variables.assertComplete(model, environment, stack.name);

    const routes = await this.stacks.routesOf([environment.id]);
    const project = await this.projects.findById(stack.projectId);
    const command = await this.queue.enqueue(
      estate,
      {
        kind: "stack-deploy",
        payload: {
          app: "",
          environment: environment.env,
          project: project?.slug,
          stack: stack.name,
          artifact: {
            id: revision.id,
            sha256: revision.sha256,
            size: revision.size,
          },
          routes: routes.map((r) => ({ service: r.service, domain: r.domain })),
          baseDomain: environment.baseDomain,
        },
      },
      input.createdBy,
    );
    return await this.rows.create({
      projectId: stack.projectId,
      environmentId: environment.id,
      revisionId: revision.id,
      revision: revision.number,
      sha256: revision.sha256,
      estateId: estate.id,
      commandId: command.id,
      status: "queued",
      createdBy: input.createdBy,
    });
  }

  /**
   * An environment's deploys, newest first, each with its status brought up
   * to date from its command.
   */
  async list(environmentId: string, limit = 50): Promise<StackDeployment[]> {
    const rows = await this.rows.findMany({
      where: { environmentId: { eq: environmentId } },
      orderBy: { column: "createdAt", direction: "desc" },
      limit,
    });
    return await this.sync(rows);
  }

  /**
   * Brings open rows up to date from their commands, and writes a terminal
   * status back so it outlives the command's pruning.
   */
  protected async sync(rows: StackDeployment[]): Promise<StackDeployment[]> {
    const open = rows.filter(
      (r) => r.status === "queued" || r.status === "running",
    );
    if (open.length === 0) {
      return rows;
    }
    const commands = await this.commands.findMany({
      where: { id: { inArray: open.map((r) => r.commandId) } },
    });
    const byId = new Map(commands.map((c) => [c.id, c]));
    const out: StackDeployment[] = [];
    for (const row of rows) {
      const command = byId.get(row.commandId);
      if (!command || (row.status !== "queued" && row.status !== "running")) {
        out.push(row);
        continue;
      }
      const status = this.statusOf(command);
      const patch = {
        status,
        step: command.step,
        error: command.status === "failed" ? command.reason : undefined,
        finishedAt: command.finishedAt,
      };
      if (status !== row.status || command.step !== row.step) {
        await this.rows.updateById(row.id, {
          status,
          step: command.step ?? null,
          error: patch.error ?? null,
          finishedAt: command.finishedAt ?? null,
        });
        if (status === "succeeded") {
          await this.environments.updateById(row.environmentId, {
            revision: row.revision,
          });
        }
      }
      out.push({ ...row, ...patch });
    }
    return out;
  }

  protected statusOf(command: EstateCommand): StackDeployment["status"] {
    switch (command.status) {
      case "done":
        return "succeeded";
      case "failed":
        return "failed";
      case "running":
        return "running";
      default:
        return "queued";
    }
  }

  // -------------------------------------------------------------------------
  // what the machine pulls, by command id
  // -------------------------------------------------------------------------

  /**
   * The deploy a `stack-deploy` command belongs to, or undefined: every
   * machine-facing answer below is resolved from this row, so a command can
   * only ever reach its own environment's variables and its own project's
   * registry credentials.
   */
  protected async deploymentOf(
    command: EstateCommand,
  ): Promise<StackDeployment | undefined> {
    if (command.kind !== "stack-deploy") {
      return undefined;
    }
    return await this.rows.findOne({
      where: { commandId: { eq: command.id } },
    });
  }

  /**
   * The bundle a `stack-deploy` names, when it is the revision its deploy
   * row recorded and the digest matches.
   */
  async bundleFor(
    command: EstateCommand,
  ): Promise<{ fileId: string; size: number; sha256: string } | undefined> {
    const deployment = await this.deploymentOf(command);
    const named = command.payload.artifact;
    if (!deployment || !named || named.id !== deployment.revisionId) {
      return undefined;
    }
    const revision = await this.revisions.findById(deployment.revisionId);
    if (!revision || revision.sha256 !== named.sha256) {
      return undefined;
    }
    return {
      fileId: revision.fileId,
      size: revision.size,
      sha256: revision.sha256,
    };
  }

  /**
   * The environment's variables, opened, for the command that deploys it.
   */
  async variablesFor(
    command: EstateCommand,
  ): Promise<Record<string, string> | undefined> {
    const deployment = await this.deploymentOf(command);
    return deployment
      ? await this.variables.open(deployment.environmentId)
      : undefined;
  }

  /**
   * The project's registry credentials, opened, for the command that deploys
   * one of its stacks. Undefined for any other command.
   */
  async registriesFor(
    command: EstateCommand,
  ): Promise<RegistryCredential[] | undefined> {
    const deployment = await this.deploymentOf(command);
    return deployment
      ? await this.registries.forDeploy(deployment.projectId)
      : undefined;
  }

  /**
   * Records what the machine did: the plan, each service, the warnings, and
   * the digests it pinned, on the revision row for a later reader.
   */
  async recordOutcome(
    command: EstateCommand,
    outcome: StackDeployOutcome,
  ): Promise<boolean> {
    const deployment = await this.deploymentOf(command);
    if (!deployment) {
      return false;
    }
    await this.rows.updateById(deployment.id, {
      plan: JSON.stringify(outcome.plan),
      services: JSON.stringify(outcome.members ?? []),
      warnings: JSON.stringify(outcome.warnings ?? []),
    });
    if (outcome.digests && Object.keys(outcome.digests).length > 0) {
      await this.revisions.updateById(deployment.revisionId, {
        digests: outcome.digests,
      });
    }
    return true;
  }

  /**
   * The bucket a bundle lives in, for the pull route.
   */
  public static readonly BUCKET = ArtifactService.BUCKET;
}
