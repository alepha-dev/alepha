import {
  $ownsProject,
  ProjectLimits,
  ProjectSecurityService,
} from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { FileService } from "alepha/api/files";
import { RankService } from "alepha/api/organizations";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { OwnedResourceProvider } from "alepha/security";
import {
  $action,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "alepha/server";

import { appInstances } from "../entities/appInstances.ts";
import { artifacts } from "../entities/artifacts.ts";
import { hostCommands } from "../entities/hostCommands.ts";
import { hostProjects } from "../entities/hostProjects.ts";
import { type Host, hosts } from "../entities/hosts.ts";
import {
  BACKUP_KINDS_REFUSED_OFFLINE,
  backupCommandInput,
  HOST_BACKUP_COMMAND_KINDS,
  type HostBackupCommandBody,
  hostBackupCommandTargetedSchema,
} from "../schemas/hostBackupCommandSchema.ts";
import {
  type HostCommandListItem,
  type HostCommandResource,
  hostCommandListItemSchema,
  hostCommandResourceSchema,
} from "../schemas/hostCommandResourceSchema.ts";
import { HostCommandService } from "../services/HostCommandService.ts";
import { HostService } from "../services/HostService.ts";
import { ResourceNameService } from "../services/ResourceNameService.ts";

export type { HostCommandListItem, HostCommandResource };

/**
 * The owner's view of a host's queue, and the commands an owner can
 * enqueue by hand.
 *
 * `restart`, `stop`, `start` and `backup` name an instance on the machine and
 * nothing else. `deploy` names an artifact by id: the app comes from the artifact row,
 * the digest is snapshotted into the payload, and Bay pulls the bytes by
 * command id (#1844). Three gates on a deploy, each server-side: the caller
 * owns the host, is a member of the artifact's project, and the host is
 * lent to that project. The host's own `deployAllowed` switch is the fourth,
 * enforced by `HostCommandService.enqueue` and again by the connector.
 *
 * ⚠️ `stop` and `start` QUEUE for an offline machine, like `restart`, bounded
 * by `PENDING_TIMEOUT_SECONDS`. A stop that lands when the machine comes back
 * is still the operator's intent; a refresh or a log tail would be worthless
 * by then, which is why those two refuse instead.
 *
 * Epic #1's deploy endpoint (#1201) is the one that resolves a host from
 * an environment row; this is the owner's hand-driven path, which is what
 * the end-to-end test (#1628) drives.
 */
export class HostCommandController {
  protected readonly hosts = $inject(HostService);
  protected readonly commands = $inject(HostCommandService);
  protected readonly ranks = $inject(RankService);
  protected readonly projectSecurity = $inject(ProjectSecurityService);
  protected readonly artifacts = $repository(artifacts);
  protected readonly projects = $repository(projects);
  protected readonly grants = $repository(hostProjects);
  protected readonly rows = $repository(hostCommands);
  protected readonly files = $inject(FileService);
  protected readonly users = $repository(users);
  protected readonly limits = $inject(ProjectLimits);
  protected readonly instances = $repository(appInstances);
  protected readonly names = $inject(ResourceNameService);
  protected readonly owned = $inject(OwnedResourceProvider);
  protected readonly hostRows = $repository(hosts);

  /**
   * The gate on the host in the path, by its home project's rank (#Q3279).
   * Listing the commands is `host:read`; queueing one and reading a log
   * tail's stored result are `host:update`, since a machine runs the copies
   * of every project that borrows it. Writes name the Apps capability.
   */
  protected ownsHost = (requires: string, write = false) =>
    $ownsProject({
      repository: () => this.hostRows,
      param: "hostId",
      requires,
      ...(write
        ? {
            capability: {
              key: "ship" as const,
              action: "send a host a command",
            },
          }
        : {}),
    });

  /**
   * The queue and its history, newest first.
   *
   * `limit` is bounded by the retention cap the sweep enforces, so the page
   * can fetch the whole kept history once and filter it in memory: at most a
   * couple of hundred rows, and the endpoint stays a plain read.
   *
   * `requestedByName` is resolved here, in ONE `inArray` query over the users
   * the page actually shows, the same shape `withLoans` uses. `requestedBy` is
   * a bare uuid on the row (set null when the person is deleted, because the
   * command outlives them), and a name per row would be a query per row.
   */
  listHostCommands = $action({
    use: [this.ownsHost("host:read")],
    method: "GET",
    path: "/hosts/:hostId/commands",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      query: z.object({ limit: z.integer().min(1).max(1000).optional() }),
      response: z.object({ items: z.array(hostCommandListItemSchema) }),
    },
    handler: async ({ params, query, user }) => {
      const host = this.owned.get<Host>();
      const cap = await this.limits.maxCommandsPerHost();
      const items = await this.commands.listFor(
        host.id,
        Math.min(query.limit ?? cap, cap),
      );

      const requesters = [
        ...new Set(
          items.flatMap((item) => (item.requestedBy ? [item.requestedBy] : [])),
        ),
      ];
      // `username` and not `name`: the realm runs in `username: "email"` mode
      // and `displayName` across the UI reads the handle, deliberately
      // ignoring the IDP-supplied full name.
      const named = new Map<string, string>(
        requesters.length
          ? (
              await this.users.findMany({
                where: { id: { inArray: requesters } },
                columns: ["id", "username", "email"],
              })
            ).flatMap((row) => {
              const label = row.username?.trim() || row.email?.split("@")[0];
              return label ? ([[row.id, label]] as [string, string][]) : [];
            })
          : [],
      );

      return {
        items: items.map((item) => {
          const name = item.requestedBy
            ? named.get(item.requestedBy)
            : undefined;
          // Absent rather than empty when the person is gone: the row is set
          // null on deletion because the command outlives them, and "nobody
          // to attribute this to" is the honest reading.
          return { ...item, ...(name ? { requestedByName: name } : {}) };
        }),
      };
    },
  });

  /**
   * Queue a command for a host. Pushed the instant it
   * is queued when the machine is connected, delivered on its next connect
   * otherwise.
   */
  enqueueHostCommand = $action({
    use: [this.ownsHost("host:update", true)],
    method: "POST",
    path: "/hosts/:hostId/commands",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      body: z.union([
        z.object({
          kind: z.enum(["restart", "stop", "start"]),
          app: z.string().min(1).max(100),
          environment: z.string().min(1).max(100),
        }),
        // The backup verbs, `app` being the machine's own instance name.
        hostBackupCommandTargetedSchema,
        z.object({
          kind: z.literal("logs"),
          app: z.string().min(1).max(100),
          environment: z.string().min(1).max(100),
          lines: z.integer().min(1).max(2000).optional(),
          sinceSeconds: z.integer().min(0).max(604_800).optional(),
          grep: z.string().max(200).optional(),
        }),
        z.object({
          kind: z.literal("deploy"),
          artifactId: z.uuid(),
          environment: z.string().min(1).max(100),
        }),
      ]),
      response: hostCommandResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const host = this.owned.get<Host>();

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

      if (
        (HOST_BACKUP_COMMAND_KINDS as readonly string[]).includes(body.kind)
      ) {
        const backup = body as HostBackupCommandBody & {
          app: string;
          environment: string;
        };
        const input = backupCommandInput(
          backup,
          backup.app,
          backup.environment,
        );
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
          },
        },
        user.id,
      );
    },
  });

  /**
   * The answer a `logs` command uploaded, streamed back. Under `host:update`,
   * like asking for one: a machine runs other projects' copies too.
   *
   * ⚠️ A row still pointing at a swept file is the NORMAL end state, not an
   * error: the blob expires after 24 hours and the framework's `FileJobs`
   * takes it. That answers 404 with "expired", which the page says in words,
   * rather than a 500 about a missing file.
   */
  getHostCommandResult = $action({
    use: [this.ownsHost("host:update")],
    method: "GET",
    path: "/hosts/:hostId/commands/:commandId/result",
    schema: {
      params: z.object({ hostId: z.uuid(), commandId: z.uuid() }),
      response: z.file(),
    },
    handler: async ({ params, user, reply }) => {
      const host = this.owned.get<Host>();
      // Scoped on both in one query, so a command of another host and one
      // that does not exist are the same empty result here too.
      const command = await this.rows.findOne({
        where: {
          id: { eq: params.commandId },
          hostId: { eq: host.id },
        },
      });
      if (!command?.resultFileId) {
        throw new NotFoundError("This command has no stored result");
      }
      try {
        const file = await this.files.streamFile(command.resultFileId);
        reply.setHeader("content-type", "application/json");
        reply.setHeader("cache-control", "no-store");
        return file;
      } catch {
        throw new NotFoundError(
          "This command's result has expired; results are kept for 24 hours",
        );
      }
    },
  });
}
