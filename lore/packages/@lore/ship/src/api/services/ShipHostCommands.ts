import {
  HostCommandHandlerRegistry,
  type HostCommandHandlerInput,
  ProjectSecurityService,
} from "@lore/core/api";
import {
  projects,
  hostProjects,
  BACKUP_KINDS_REFUSED_OFFLINE,
  backupCommandInput,
  HOST_BACKUP_COMMAND_KINDS,
  type HostBackupCommandBody,
  type HostCommandResource,
} from "@lore/core/schemas";
import { $inject } from "alepha";
import { RankService } from "alepha/api/organizations";
import { $repository } from "alepha/orm";
import { BadRequestError, ForbiddenError, NotFoundError } from "alepha/server";

import { appInstances } from "../entities/appInstances.ts";
import { artifacts } from "../entities/artifacts.ts";
import { HostCommandService } from "./HostCommandService.ts";
import { HostService } from "./HostService.ts";
import { ResourceNameService } from "./ResourceNameService.ts";

/**
 * Ship's host commands, registered on core's `HostCommandHandlerRegistry`
 * (#E166, #Q4098): `restart`, `stop`, `start`, the backup verbs, `logs` and
 * `deploy`. Each names a copy on the machine or an artifact to put there,
 * which is deploying, so each needs the host's home project to have Ship.
 * Nothing injects it: `LoreShipApi` lists it.
 */
export class ShipHostCommands {
  public static readonly KINDS = [
    "restart",
    "stop",
    "start",
    ...HOST_BACKUP_COMMAND_KINDS,
    "logs",
    "deploy",
  ] as const;

  protected readonly handlers = $inject(HostCommandHandlerRegistry);
  protected readonly hosts = $inject(HostService);
  protected readonly commands = $inject(HostCommandService);
  protected readonly ranks = $inject(RankService);
  protected readonly projectSecurity = $inject(ProjectSecurityService);
  protected readonly artifacts = $repository(artifacts);
  protected readonly projects = $repository(projects);
  protected readonly grants = $repository(hostProjects);
  protected readonly instances = $repository(appInstances);
  protected readonly names = $inject(ResourceNameService);

  constructor() {
    this.handlers.register(ShipHostCommands.KINDS, (input) =>
      this.enqueue(input),
    );
  }

  protected async enqueue(
    input: HostCommandHandlerInput,
  ): Promise<HostCommandResource> {
    const { host, user } = input;
    const body = input.body as any;
    if (host.projectId !== null && host.projectId !== undefined) {
      await this.projectSecurity.assertCapability(host.projectId, "ship", {
        action: "send a host a command",
      });
    }

    if (body.kind === "logs") {
      // ⚠️ The one verb in this epic that refuses instead of queueing, and
      // the one place the queue-and-redeliver pattern #E20 built is
      // deliberately broken. A tail delivered three hours later, after
      // nobody is looking, is worse than an error: it is a read, and a
      // stale read is worthless. Refused before any row is written.
      if (!this.hosts.isOnline(host)) {
        throw new BadRequestError(
          `Host "${host.slug}" is not connected right now, so its logs cannot be read`,
        );
      }
      return this.commands.enqueue(
        host,
        {
          kind: "logs",
          payload: {
            app: body.app,
            environment: body.environment,
            logs: {
              lines: body.lines ?? 200,
              ...(body.sinceSeconds === undefined
                ? {}
                : { sinceSeconds: body.sinceSeconds }),
              ...(body.grep === undefined ? {} : { grep: body.grep }),
            },
          },
        },
        user.id,
      );
    }

    if ((HOST_BACKUP_COMMAND_KINDS as readonly string[]).includes(body.kind)) {
      const backup = body as HostBackupCommandBody & {
        app: string;
        environment: string;
      };
      const input = backupCommandInput(backup, backup.app, backup.environment);
      if (
        BACKUP_KINDS_REFUSED_OFFLINE.includes(body.kind) &&
        !this.hosts.isOnline(host)
      ) {
        throw new BadRequestError(
          `Host "${host.slug}" is not connected right now: a ${body.kind} waits for it to be back rather than running hours later.`,
        );
      }
      return this.commands.enqueue(host, input, user.id);
    }

    if (body.kind !== "deploy") {
      // `restart`, `stop` and `start` all name one instance on
      // the machine and nothing else, so they share a shape and a gate. The
      // deploy path below is the one that needs an artifact, a project and
      // a lending.
      return this.commands.enqueue(
        host,
        {
          kind: body.kind,
          payload: { app: body.app, environment: body.environment },
        },
        user.id,
      );
    }

    // ⚠️ ranks: imperative. The check here is on the ARTIFACT's project,
    // named indirectly by the body and only on the `deploy` branch of a
    // discriminated union - while the action's own gate is the host's
    // owner. A middleware cannot serve a conditional check on a second
    // scope, so this asks the ranks module directly.
    const artifact = await this.artifacts.findOne({
      where: { id: { eq: body.artifactId } },
    });
    if (!artifact) {
      throw new NotFoundError("Artifact not found");
    }
    // ⚠️ A THIRD deploy entry point, reached by artifact id rather than by
    // tag, so the format gate belongs here too: a `deploy` command names an
    // artifact for a Bay machine to fetch, and an image row has no bytes to
    // fetch. Refused by name here, where the caller is still holding the
    // request, rather than as an opaque pull refusal on the machine.
    const { fileId, size } = artifact;
    if (artifact.format !== "archive" || !fileId || size === undefined) {
      throw new BadRequestError(
        `${artifact.app} ${artifact.tag} is a container image (${artifact.reference ?? "no reference recorded"}), not a packed build. Bay runs a Node process under systemd, not containers - deploy an artifact pushed with \`lore artifacts push\`.`,
      );
    }
    await this.ranks.assert(
      await this.projectSecurity.organizationIdOf(artifact.projectId),
      "artifact:read",
      user,
    );
    const project = await this.projects.findById(artifact.projectId);
    const lent = await this.grants.findOne({
      where: {
        hostId: { eq: host.id },
        projectId: { eq: artifact.projectId },
      },
    });
    if (!lent) {
      throw new ForbiddenError(
        `Host "${host.slug}" is not lent to the project this artifact belongs to`,
      );
    }

    // ⚠️ The copy this deploy is FOR, resolved from the artifact's project,
    // app and the environment named. Its stored name is what keeps a
    // project rename from moving the Bay instance: the slug is read once,
    // on the copy's first deploy, and never again (#Q2475).
    // Asked first: the name below is stored, and a deploy this host
    // refuses must not leave one behind.
    this.commands.assertAccepts(host, "deploy");
    const instance = await this.instances.findOne({
      where: {
        projectId: { eq: artifact.projectId },
        app: { eq: artifact.app },
        env: { eq: body.environment },
      },
    });
    if (!instance) {
      throw new BadRequestError(
        `${project?.title ?? "This project"} has no copy named ${artifact.app}/${body.environment}. Create it on the project's Apps page and choose "${host.slug}" as its host, then deploy.`,
      );
    }
    if (instance.hostId !== host.id) {
      throw new BadRequestError(
        `${artifact.app}/${body.environment} deploys to another host. Choose "${host.slug}" on its Settings tab to deploy it here.`,
      );
    }
    const name = await this.names.resolve(instance, host);
    const segment = this.names.projectSegmentOf(instance, name);

    return this.commands.enqueue(
      host,
      {
        kind: "deploy",
        payload: {
          app: artifact.app,
          environment: body.environment,
          // ⚠️ From the copy's STORED name, never from the project's current
          // slug, and never from anything the caller sent: a client that
          // could name its own project segment could land a copy on another
          // project's directory, and a recomputed one moves the copy after a
          // project rename.
          ...(segment ? { project: segment } : {}),
          artifact: {
            id: artifact.id,
            sha256: artifact.sha256,
            size,
          },
          // As on a deploy from the app page (#Q3796).
          ...(instance.domains?.length ? { domains: instance.domains } : {}),
        },
      },
      user.id,
    );
  }
}
