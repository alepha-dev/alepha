import { $inject, z } from "alepha";
import { FileService } from "alepha/api/files";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import {
  $action,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "alepha/server";

import { artifacts } from "../entities/artifacts.ts";
import { estateCommands } from "../entities/estateCommands.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import {
  type EstateCommandListItem,
  type EstateCommandResource,
  estateCommandListItemSchema,
  estateCommandResourceSchema,
} from "../schemas/estateCommandResourceSchema.ts";
import { EstateCommandService } from "../services/EstateCommandService.ts";
import { EstateService } from "../services/EstateService.ts";
import { ProjectLimits } from "../services/ProjectLimits.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

export type { EstateCommandListItem, EstateCommandResource };

/**
 * The owner's view of an estate's queue, and the commands an owner can
 * enqueue by hand.
 *
 * `restart`, `stop`, `start` and `backup` name an instance on the machine and
 * nothing else. `deploy` names an artifact by id: the app comes from the artifact row,
 * the digest is snapshotted into the payload, and Bay pulls the bytes by
 * command id (#1844). Three gates on a deploy, each server-side: the caller
 * owns the estate, is a member of the artifact's project, and the estate is
 * lent to that project. The estate's own `deployAllowed` switch is the fourth,
 * enforced by `EstateCommandService.enqueue` and again by the connector.
 *
 * ⚠️ `stop` and `start` QUEUE for an offline machine, like `restart`, bounded
 * by `PENDING_TIMEOUT_SECONDS`. A stop that lands when the machine comes back
 * is still the operator's intent; a refresh or a log tail would be worthless
 * by then, which is why those two refuse instead.
 *
 * Epic #1's deploy endpoint (#1201) is the one that resolves an estate from
 * an environment row; this is the owner's hand-driven path, which is what
 * the end-to-end test (#1628) drives.
 */
export class EstateCommandController {
  protected readonly estates = $inject(EstateService);
  protected readonly commands = $inject(EstateCommandService);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly artifacts = $repository(artifacts);
  protected readonly grants = $repository(estateProjects);
  protected readonly rows = $repository(estateCommands);
  protected readonly files = $inject(FileService);
  protected readonly users = $repository(users);
  protected readonly limits = $inject(ProjectLimits);

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
  listEstateCommands = $action({
    use: [$secure({ permissions: ["estate:read"] })],
    method: "GET",
    path: "/estates/:estateId/commands",
    schema: {
      params: z.object({ estateId: z.uuid() }),
      query: z.object({ limit: z.integer().min(1).max(1000).optional() }),
      response: z.object({ items: z.array(estateCommandListItemSchema) }),
    },
    handler: async ({ params, query, user }) => {
      const estate = await this.estates.loadOwned(params.estateId, user);
      const cap = await this.limits.maxCommandsPerEstate();
      const items = await this.commands.listFor(
        estate.id,
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
   * Queue a command for one of the caller's estates. Pushed the instant it
   * is queued when the machine is connected, delivered on its next connect
   * otherwise.
   */
  enqueueEstateCommand = $action({
    use: [$secure({ permissions: ["estate:update"] })],
    method: "POST",
    path: "/estates/:estateId/commands",
    schema: {
      params: z.object({ estateId: z.uuid() }),
      body: z.union([
        z.object({
          kind: z.enum(["restart", "stop", "start", "backup"]),
          app: z.string().min(1).max(100),
          environment: z.string().min(1).max(100),
        }),
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
      response: estateCommandResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const estate = await this.estates.loadOwned(params.estateId, user);

      if (body.kind === "logs") {
        // ⚠️ The one verb in this epic that refuses instead of queueing, and
        // the one place the queue-and-redeliver pattern #E20 built is
        // deliberately broken. A tail delivered three hours later, after
        // nobody is looking, is worse than an error: it is a read, and a
        // stale read is worthless. Refused before any row is written.
        if (!this.estates.isOnline(estate)) {
          throw new BadRequestError(
            `Estate "${estate.slug}" is not connected right now, so its logs cannot be read`,
          );
        }
        return this.commands.enqueue(
          estate,
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

      if (body.kind !== "deploy") {
        // `restart`, `stop`, `start` and `backup` all name one instance on
        // the machine and nothing else, so they share a shape and a gate. The
        // deploy path below is the one that needs an artifact, a project and
        // a lending.
        return this.commands.enqueue(
          estate,
          {
            kind: body.kind,
            payload: { app: body.app, environment: body.environment },
          },
          user.id,
        );
      }

      const artifact = await this.artifacts.findOne({
        where: { id: { eq: body.artifactId } },
      });
      if (!artifact) {
        throw new NotFoundError("Artifact not found");
      }
      await this.security.assertMember(artifact.projectId, user);
      const lent = await this.grants.findOne({
        where: {
          estateId: { eq: estate.id },
          projectId: { eq: artifact.projectId },
        },
      });
      if (!lent) {
        throw new ForbiddenError(
          `Estate "${estate.slug}" is not lent to the project this artifact belongs to`,
        );
      }

      return this.commands.enqueue(
        estate,
        {
          kind: "deploy",
          payload: {
            app: artifact.app,
            environment: body.environment,
            artifact: {
              id: artifact.id,
              sha256: artifact.sha256,
              size: artifact.size,
            },
          },
        },
        user.id,
      );
    },
  });

  /**
   * The answer a `logs` command uploaded, streamed back to the owner.
   *
   * ⚠️ A row still pointing at a swept file is the NORMAL end state, not an
   * error: the blob expires after 24 hours and the framework's `FileJobs`
   * takes it. That answers 404 with "expired", which the page says in words,
   * rather than a 500 about a missing file.
   */
  getEstateCommandResult = $action({
    use: [$secure({ permissions: ["estate:read"] })],
    method: "GET",
    path: "/estates/:estateId/commands/:commandId/result",
    schema: {
      params: z.object({ estateId: z.uuid(), commandId: z.uuid() }),
      response: z.file(),
    },
    handler: async ({ params, user, reply }) => {
      const estate = await this.estates.loadOwned(params.estateId, user);
      // Scoped on both in one query, so a command of another estate and one
      // that does not exist are the same empty result here too.
      const command = await this.rows.findOne({
        where: {
          id: { eq: params.commandId },
          estateId: { eq: estate.id },
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
          "This command's result has expired; logs are kept for 24 hours",
        );
      }
    },
  });
}
