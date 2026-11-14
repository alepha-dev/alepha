import { $ownsProject } from "@lore/core/api";
import { appNameSchema } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { FileService } from "alepha/api/files";
import { $repository } from "alepha/orm";
import { $action, BadRequestError, NotFoundError } from "alepha/server";

import type { AppInstance } from "../entities/appInstances.ts";
import { hostCommands } from "../entities/hostCommands.ts";
import { hostEvents } from "../entities/hostEvents.ts";
import { type Host, hosts } from "../entities/hosts.ts";
import { appBackupViewSchema } from "../schemas/appBackupViewSchema.ts";
import {
  BACKUP_KINDS_REFUSED_OFFLINE,
  backupCommandInput,
  HOST_BACKUP_COMMAND_KINDS,
  hostBackupCommandBodySchema,
} from "../schemas/hostBackupCommandSchema.ts";
import { hostCommandResourceSchema } from "../schemas/hostCommandResourceSchema.ts";
import { AppService } from "../services/AppService.ts";
import { BayRemovalService } from "../services/BayRemovalService.ts";
import { HostCommandService } from "../services/HostCommandService.ts";
import { HostEventService } from "../services/HostEventService.ts";
import { HostInventoryService } from "../services/HostInventoryService.ts";
import { HostService } from "../services/HostService.ts";

/**
 * Backups of apps that run on a Bay, as the machine reports them.
 *
 * Two doors onto the same data. The host owner reads every instance's
 * events from the host page. A project member reads one copy's backups from
 * its Backups tab, and with `deploy:manage` sends it the backup verbs: the
 * same commands the host page sends, aimed by Lore at the copy's own
 * instance - never at a name the caller chose, so a project can only reach
 * the instances it deployed. Two things stay the owner's: a restore from
 * another instance, and the backup policy override (Bay's operator layer).
 *
 * ⚠️ A restore is gated twice more, by the host's `deployAllowed` (here, in
 * `HostCommandService.assertAccepts`) and again by Bay itself from its
 * `welcome` frame.
 */
export class BackupController {
  protected readonly hostService = $inject(HostService);
  protected readonly apps = $inject(AppService);
  protected readonly commands = $inject(HostCommandService);
  protected readonly events = $inject(HostEventService);
  protected readonly inventories = $inject(HostInventoryService);
  protected readonly bay = $inject(BayRemovalService);
  protected readonly files = $inject(FileService);
  protected readonly rows = $repository(hostCommands);
  protected readonly hostRows = $repository(hosts);

  protected writeGate = () =>
    $ownsProject({
      param: "projectId",
      requires: "deploy:manage",
      capability: { key: "apps", option: "deploy" },
    });

  protected readGate = () =>
    $ownsProject({ param: "projectId", requires: "app:read" });

  /** What the machine reported happening, newest first. */
  listHostEvents = $action({
    use: [
      $ownsProject({
        repository: () => this.hostRows,
        param: "hostId",
        requires: "host:read",
      }),
    ],
    method: "GET",
    path: "/hosts/:hostId/events",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      query: z.object({
        app: z.string().min(1).max(100).optional(),
        env: z.string().min(1).max(100).optional(),
        limit: z.integer().min(1).max(200).optional(),
      }),
      response: z.object({ items: z.array(hostEvents.schema) }),
    },
    handler: async ({ params, query, user }) => {
      return { items: await this.events.list(params.hostId, query) };
    },
  });

  getAppBackup = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/apps/:app/:env/backup",
    description: "A deployed copy's backups, as its Bay machine reports them.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        app: appNameSchema,
        env: appNameSchema,
      }),
      query: z.object({ limit: z.integer().min(1).max(200).optional() }),
      response: appBackupViewSchema,
    },
    handler: async ({ params, query }) => {
      const instance = await this.apps.load(
        params.projectId,
        params.app,
        params.env,
      );
      const target = await this.target(instance);
      if (target.status !== "ok") {
        return {
          status: target.status,
          events: [],
          ...(target.host ? { host: this.describe(target.host) } : {}),
        };
      }
      const { host, machineApp } = target;
      const inventory = await this.inventories.findFor(host.id);
      const row = inventory?.apps.find(
        (app) => app.app === machineApp && app.env === instance.env,
      );
      return {
        status: row ? ("reported" as const) : ("not-reported" as const),
        host: this.describe(host),
        machineApp,
        ...(inventory ? { reportedAt: inventory.reportedAt } : {}),
        ...(row ? { instance: row } : {}),
        events: await this.events.list(host.id, {
          app: machineApp,
          env: instance.env,
          limit: query.limit ?? 50,
        }),
      };
    },
  });

  sendAppBackupCommand = $action({
    use: [this.writeGate()],
    method: "POST",
    path: "/projects/:projectId/apps/:app/:env/backup/commands",
    description:
      "Back up, list, verify, probe, set the policy of, or restore a deployed copy on its Bay.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        app: appNameSchema,
        env: appNameSchema,
      }),
      body: hostBackupCommandBodySchema,
      response: hostCommandResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const instance = await this.apps.load(
        params.projectId,
        params.app,
        params.env,
      );
      if ("from" in body && body.from) {
        throw new BadRequestError(
          "Restoring from another instance is reserved to the host's console, under host:update in its home project.",
        );
      }
      // Bay's operator layer belongs to the host's home project: a project declares its
      // policy with the deploy (`bay({ backup })`), bounded as the app layer.
      if (body.kind === "backup-policy") {
        throw new BadRequestError(
          "Overriding the backup policy is reserved to the host's home project: declare it in alepha.config.ts and deploy.",
        );
      }
      const { host, machineApp } = await this.requireTarget(instance);
      const input = backupCommandInput(body, machineApp, instance.env);
      if (
        BACKUP_KINDS_REFUSED_OFFLINE.includes(body.kind) &&
        !this.hostService.isOnline(host)
      ) {
        throw new BadRequestError(
          `Host "${host.slug}" is not connected right now: a ${body.kind} waits for it to be back rather than running hours later.`,
        );
      }
      return this.commands.enqueue(host, input, user.id);
    },
  });

  getAppBackupCommand = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/apps/:app/:env/backup/commands/:commandId",
    schema: {
      params: z.object({
        projectId: z.integer(),
        app: appNameSchema,
        env: appNameSchema,
        commandId: z.uuid(),
      }),
      response: hostCommandResourceSchema,
    },
    handler: async ({ params }) => this.loadCommand(params),
  });

  /**
   * What a `backups-list`, `backup-verify`, `target-probe` or `restore`
   * uploaded. Kept 24 hours, like a log tail.
   */
  getAppBackupCommandResult = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/apps/:app/:env/backup/commands/:commandId/result",
    schema: {
      params: z.object({
        projectId: z.integer(),
        app: appNameSchema,
        env: appNameSchema,
        commandId: z.uuid(),
      }),
      response: z.file(),
    },
    handler: async ({ params, reply }) => {
      const command = await this.loadCommand(params);
      if (!command.resultFileId) {
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

  /**
   * One backup command of this copy. Scoped on the host AND the copy's
   * machine name, so a project cannot read another project's commands on a
   * shared machine by guessing ids, nor its log tails through this door.
   */
  protected async loadCommand(params: {
    projectId: number;
    app: string;
    env: string;
    commandId: string;
  }) {
    const instance = await this.apps.load(
      params.projectId,
      params.app,
      params.env,
    );
    const target = await this.target(instance);
    const command =
      target.status === "ok"
        ? await this.rows.findOne({
            where: {
              id: { eq: params.commandId },
              hostId: { eq: target.host.id },
            },
          })
        : undefined;
    if (
      !command ||
      target.status !== "ok" ||
      !(HOST_BACKUP_COMMAND_KINDS as readonly string[]).includes(
        command.kind,
      ) ||
      command.payload.app !== target.machineApp ||
      command.payload.environment !== instance.env
    ) {
      throw new NotFoundError("No such backup command for this app");
    }
    return command;
  }

  protected async requireTarget(instance: AppInstance) {
    const target = await this.target(instance);
    switch (target.status) {
      case "ok":
        return target;
      case "no-host":
        throw new BadRequestError(
          `${instance.app}/${instance.env} has no host. Choose one on its Settings tab.`,
        );
      case "not-bay":
        throw new BadRequestError(
          "This copy runs on Cloudflare, whose databases Bay does not back up.",
        );
      case "not-lent":
        throw new NotFoundError(
          "The host this copy runs on is no longer lent to this project.",
        );
      default:
        throw new BadRequestError(
          `${instance.app}/${instance.env} has not been deployed to its Bay yet, so there is nothing to back up.`,
        );
    }
  }

  /**
   * The Bay instance a copy is: `BayRemovalService.target`, the one place
   * that reads a copy's stored machine name.
   */
  protected async target(instance: AppInstance) {
    return this.bay.target(instance);
  }

  protected describe(host: Host) {
    return {
      id: host.id,
      slug: host.slug,
      ...(host.label ? { label: host.label } : {}),
      online: this.hostService.isOnline(host),
      deployAllowed: host.deployAllowed,
    };
  }
}
