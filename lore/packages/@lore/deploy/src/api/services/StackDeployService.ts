import { projects } from "@lore/core/schemas";
import { $hook, $inject } from "alepha";
import { BAY_OWNED_SECRET_KEYS } from "alepha/cli/infra-lib";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import type { AppInstance } from "../entities/appInstances.ts";
import { artifacts } from "../entities/artifacts.ts";
import { type Deployment, deployments } from "../entities/deployments.ts";
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
import { AppSecretService } from "./AppSecretService.ts";
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
  protected readonly appDeployments = $repository(deployments);
  protected readonly artifacts = $repository(artifacts);
  protected readonly commands = $repository(estateCommands);
  protected readonly environments = $repository(stackEnvironments);
  protected readonly revisions = $repository(stackRevisions);
  protected readonly estates = $repository(estates);
  protected readonly grants = $repository(estateProjects);
  protected readonly projects = $repository(projects);
  protected readonly stacks = $inject(StackService);
  protected readonly variables = $inject(StackVariableService);
  protected readonly appSecrets = $inject(AppSecretService);
  protected readonly registries = $inject(RegistryCredentialService);
  protected readonly targets = $inject(StackTargets);
  protected readonly queue = $inject(EstateCommandService);
  protected readonly dateTime = $inject(DateTimeProvider);

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

    const estate = await this.estateFor(stack, environment, where);

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
   * The estate a stack environment deploys to, checked: lent to the project,
   * a Bay, accepting deploys. The same messages as an app deploy.
   */
  protected async estateFor(
    stack: { projectId: number; estateId?: string },
    environment: { estateId?: string },
    where: string,
  ) {
    const estateId = environment.estateId ?? stack.estateId;
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

    return estate;
  }

  /**
   * Deploys an app instance that is a member of a stack environment: its
   * artifact goes into its own app service alone, blue/green on Bay, against
   * the stack's CURRENT revision. Nothing of the compose file is applied, and
   * no other service is touched (#Q2695).
   *
   * Recorded as an ordinary `deployments` row of the instance, whose status
   * follows the estate command rather than a run in this Worker.
   */
  async deployMember(input: {
    instance: AppInstance;
    tag: string;
    createdBy?: string;
  }): Promise<Deployment> {
    const { instance } = input;
    const environment = instance.stackEnvironmentId
      ? await this.environments.findById(instance.stackEnvironmentId)
      : undefined;
    if (!environment) {
      throw new BadRequestError(
        `${instance.app}/${instance.env} is not a member of a stack environment`,
      );
    }
    const stack = await this.stacks.get(
      instance.projectId,
      environment.stackId,
    );
    const where = `${stack.name}/${environment.env}`;
    const estate = await this.estateFor(stack, environment, where);
    if (!environment.revision) {
      throw new BadRequestError(
        `${where} has never been deployed, so ${instance.app} has no service to go into yet: deploy the stack first`,
      );
    }
    const revision = await this.stacks.getRevision(stack, environment.revision);
    const model = JSON.parse(revision.model) as StackModel;
    const service = model.services.find(
      (s) => s.kind === "app" && s.app === instance.app,
    );
    if (!service) {
      throw new BadRequestError(
        `${where} revision ${revision.number} has no app service for ${instance.app} (x-lore.app: ${instance.app})`,
      );
    }
    const artifact = await this.artifacts.findOne({
      where: {
        projectId: { eq: instance.projectId },
        app: { eq: instance.app },
        tag: { eq: input.tag },
        format: { eq: ArtifactService.ARCHIVE },
      },
    });
    if (!artifact) {
      throw new NotFoundError(
        `${instance.app} has no archive tagged '${input.tag}'. Push one with \`lore artifacts push\`, or deploy a tag that exists.`,
      );
    }
    const command = await this.queue.enqueue(
      estate,
      {
        kind: "deploy",
        payload: {
          app: instance.app,
          environment: environment.env,
          stack: stack.name,
          service: service.name,
          instanceId: instance.id,
          artifact: {
            id: artifact.id,
            sha256: artifact.sha256,
            size: artifact.size ?? 0,
          },
        },
      },
      input.createdBy,
    );
    return await this.appDeployments.create({
      projectId: instance.projectId,
      instanceId: instance.id,
      artifactId: artifact.id,
      app: artifact.app,
      tag: artifact.tag,
      sha256: artifact.sha256,
      status: "queued",
      commandId: command.id,
      createdBy: input.createdBy,
      log: [
        {
          at: new Date(this.dateTime.nowMillis()).toISOString(),
          text: `Queued for ${service.name} in ${where} on ${estate.slug}`,
        },
      ],
    });
  }

  /**
   * Follows the machine: every ack (and every sweep) moves the deploy row
   * riding on that command, a stack deploy or a member's app deploy.
   */
  protected readonly onCommandProgressed = $hook({
    on: "estate:command:progressed",
    handler: async ({ command }) => {
      const stackRow = await this.rows.findOne({
        where: { commandId: { eq: command.id } },
      });
      if (stackRow) {
        await this.sync([stackRow]);
        return;
      }
      const appRow = await this.appDeployments.findOne({
        where: { commandId: { eq: command.id } },
      });
      if (
        appRow &&
        (appRow.status === "queued" || appRow.status === "running")
      ) {
        const status = this.statusOf(command);
        const now = new Date(this.dateTime.nowMillis()).toISOString();
        const terminal = status === "succeeded" || status === "failed";
        await this.appDeployments.updateById(appRow.id, {
          status,
          ...(status !== "queued" && !appRow.startedAt
            ? { startedAt: command.runningAt ?? now }
            : {}),
          ...(terminal ? { finishedAt: command.finishedAt ?? now } : {}),
          ...(status === "failed"
            ? { error: command.reason ?? "The machine reported a failure" }
            : {}),
          log: [
            ...appRow.log,
            {
              at: now,
              text:
                command.step && !terminal
                  ? `On the machine: ${command.step}`
                  : `The machine reports ${command.status}`,
            },
          ].slice(-200),
        });
      }
    },
  });

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
   * A member deploy's app variables, opened, without Bay's own names, when
   * the command really is that copy's deploy: the deploy row of that
   * instance carries this command id.
   */
  async memberSecretsFor(
    command: EstateCommand,
  ): Promise<Record<string, string> | undefined> {
    const instanceId = command.payload.instanceId;
    if (command.kind !== "deploy" || !instanceId) {
      return undefined;
    }
    const row = await this.appDeployments.findOne({
      where: { commandId: { eq: command.id }, instanceId: { eq: instanceId } },
    });
    if (!row) {
      return undefined;
    }
    return await this.appSecrets.open(instanceId, {
      except: BAY_OWNED_SECRET_KEYS,
    });
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
