import { $inject, z } from "alepha";
import { FileService } from "alepha/api/files";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { OwnedResourceProvider } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";

import { hostCommands } from "../entities/hostCommands.ts";
import { type Host, hosts } from "../entities/hosts.ts";
import { BayUpgrade } from "../schemas/BayUpgrade.ts";
import { hostBackupCommandTargetedSchema } from "../schemas/hostBackupCommandSchema.ts";
import {
  type HostCommandListItem,
  type HostCommandResource,
  hostCommandListItemSchema,
  hostCommandResourceSchema,
} from "../schemas/hostCommandResourceSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { HostCommandHandlerRegistry } from "../services/HostCommandHandlerRegistry.ts";
import { HostCommandService } from "../services/HostCommandService.ts";
import { HostService } from "../services/HostService.ts";
import { HostUpgradeService } from "../services/HostUpgradeService.ts";
import { ProjectLimits } from "../services/ProjectLimits.ts";

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
  protected readonly upgrades = $inject(HostUpgradeService);
  protected readonly handlers = $inject(HostCommandHandlerRegistry);
  protected readonly rows = $repository(hostCommands);
  protected readonly files = $inject(FileService);
  protected readonly users = $repository(users);
  protected readonly limits = $inject(ProjectLimits);
  protected readonly owned = $inject(OwnedResourceProvider);
  protected readonly hostRows = $repository(hosts);

  /**
   * The gate on the host in the path, by its home project's rank (#Q3279).
   * Listing the commands is `host:read`; queueing one and reading a log
   * tail's stored result are `host:update`, since a machine runs the copies
   * of every project that borrows it. No capability (#E166): Ship's own
   * command kinds check theirs in Ship's handler.
   */
  protected ownsHost = (requires: string) =>
    $ownsProject({
      repository: () => this.hostRows,
      param: "hostId",
      requires,
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
    use: [this.ownsHost("host:update")],
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
        // Upgrade Bay itself (#E152). Without a version, the release this
        // Lore was built from. Nothing else: no address, no checksum.
        z.object({
          kind: z.literal("upgrade"),
          version: z.string().max(20).regex(BayUpgrade.VERSION).optional(),
        }),
      ]),
      response: hostCommandResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const host = this.owned.get<Host>();

      if (body.kind === "upgrade") {
        // Home project only, by this action's own gate: a project that
        // borrows a host cannot upgrade it. Everything else that would make
        // it fail is refused by the service, before any row.
        return this.upgrades.enqueue(host, body.version, user.id);
      }

      // Every other kind is Ship's (the app, backup, logs and deploy verbs),
      // reached through core's registry (#E166): its handler checks the
      // capability, the artifact and the lending.
      return this.handlers.enqueue({ host, body, user });
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
