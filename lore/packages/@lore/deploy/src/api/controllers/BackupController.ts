import { $ownsProject } from "@lore/core/api";
import { appNameSchema } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { FileService } from "alepha/api/files";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, BadRequestError, NotFoundError } from "alepha/server";

import type { AppInstance } from "../entities/appInstances.ts";
import { estateCommands } from "../entities/estateCommands.ts";
import { estateEvents } from "../entities/estateEvents.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { type Estate, estates } from "../entities/estates.ts";
import {
  APP_BACKUP_STATUSES,
  appBackupViewSchema,
} from "../schemas/appBackupViewSchema.ts";
import {
  BACKUP_KINDS_REFUSED_OFFLINE,
  backupCommandInput,
  ESTATE_BACKUP_COMMAND_KINDS,
  estateBackupCommandBodySchema,
} from "../schemas/estateBackupCommandSchema.ts";
import { estateCommandResourceSchema } from "../schemas/estateCommandResourceSchema.ts";
import { AppService } from "../services/AppService.ts";
import { EstateCommandService } from "../services/EstateCommandService.ts";
import { EstateEventService } from "../services/EstateEventService.ts";
import { EstateInventoryService } from "../services/EstateInventoryService.ts";
import { EstateService } from "../services/EstateService.ts";

/**
 * Backups of apps that run on a Bay, as the machine reports them.
 *
 * Two doors onto the same data. The estate owner reads every instance's
 * events from the estate page. A project member reads one copy's backups from
 * its Backups tab, and with `deploy:manage` sends it the backup verbs: the
 * same commands the estate page sends, aimed by Lore at the copy's own
 * instance - never at a name the caller chose, so a project can only reach
 * the instances it deployed.
 *
 * ⚠️ Restore and a policy change are gated twice more, by the estate's
 * `deployAllowed` (here, in `EstateCommandService.assertAccepts`) and again
 * by Bay itself from its `welcome` frame.
 */
export class BackupController {
  protected readonly estateService = $inject(EstateService);
  protected readonly apps = $inject(AppService);
  protected readonly commands = $inject(EstateCommandService);
  protected readonly events = $inject(EstateEventService);
  protected readonly inventories = $inject(EstateInventoryService);
  protected readonly files = $inject(FileService);
  protected readonly estates = $repository(estates);
  protected readonly grants = $repository(estateProjects);
  protected readonly rows = $repository(estateCommands);

  protected writeGate = () =>
    $ownsProject({
      param: "projectId",
      requires: "deploy:manage",
      capability: { key: "apps", option: "deploy" },
    });

  protected readGate = () =>
    $ownsProject({ param: "projectId", requires: "app:read" });

  /** What the machine reported happening, newest first. */
  listEstateEvents = $action({
    use: [$secure({ permissions: ["estate:read"] })],
    method: "GET",
    path: "/estates/:estateId/events",
    schema: {
      params: z.object({ estateId: z.uuid() }),
      query: z.object({
        app: z.string().min(1).max(100).optional(),
        env: z.string().min(1).max(100).optional(),
        limit: z.integer().min(1).max(200).optional(),
      }),
      response: z.object({ items: z.array(estateEvents.schema) }),
    },
    handler: async ({ params, query, user }) => {
      const estate = await this.estateService.loadOwned(params.estateId, user);
      return { items: await this.events.list(estate.id, query) };
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
          ...(target.estate ? { estate: this.describe(target.estate) } : {}),
        };
      }
      const { estate, machineApp } = target;
      const inventory = await this.inventories.findFor(estate.id);
      const row = inventory?.apps.find(
        (app) => app.app === machineApp && app.env === instance.env,
      );
      return {
        status: row ? ("reported" as const) : ("not-reported" as const),
        estate: this.describe(estate),
        machineApp,
        ...(inventory ? { reportedAt: inventory.reportedAt } : {}),
        ...(row ? { instance: row } : {}),
        events: await this.events.list(estate.id, {
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
      body: estateBackupCommandBodySchema,
      response: estateCommandResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const instance = await this.apps.load(
        params.projectId,
        params.app,
        params.env,
      );
      if ("from" in body && body.from) {
        throw new BadRequestError(
          "Restoring from another instance is reserved to the estate's owner.",
        );
      }
      const { estate, machineApp } = await this.requireTarget(instance);
      const input = backupCommandInput(body, machineApp, instance.env);
      if (
        BACKUP_KINDS_REFUSED_OFFLINE.includes(body.kind) &&
        !this.estateService.isOnline(estate)
      ) {
        throw new BadRequestError(
          `Estate "${estate.slug}" is not connected right now: a ${body.kind} waits for it to be back rather than running hours later.`,
        );
      }
      return this.commands.enqueue(estate, input, user.id);
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
      response: estateCommandResourceSchema,
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
   * One backup command of this copy. Scoped on the estate AND the copy's
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
              estateId: { eq: target.estate.id },
            },
          })
        : undefined;
    if (
      !command ||
      target.status !== "ok" ||
      !(ESTATE_BACKUP_COMMAND_KINDS as readonly string[]).includes(
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
      case "no-estate":
        throw new BadRequestError(
          `${instance.app}/${instance.env} has no estate. Choose one on its Settings tab.`,
        );
      case "not-bay":
        throw new BadRequestError(
          "This copy runs on Cloudflare, whose databases Bay does not back up.",
        );
      case "not-lent":
        throw new NotFoundError(
          "The estate this copy runs on is no longer lent to this project.",
        );
      default:
        throw new BadRequestError(
          `${instance.app}/${instance.env} has not been deployed to its Bay yet, so there is nothing to back up.`,
        );
    }
  }

  /**
   * The Bay instance a copy is, checked the way `DeployGate` checks a deploy:
   * an estate, still there, still lent, a Bay, and a name the copy was
   * deployed under ON THAT estate (`resourceEstateId`).
   *
   * ⚠️ Reads the STORED name and never `ResourceNameService.resolve`, which
   * stores one: looking at a tab must not name a copy that never deployed.
   */
  protected async target(instance: AppInstance): Promise<
    | { status: "ok"; estate: Estate; machineApp: string }
    | {
        status: Exclude<
          (typeof APP_BACKUP_STATUSES)[number],
          "reported" | "not-reported"
        >;
        estate?: Estate;
      }
  > {
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
    // project's instance: its backups and restores are not ours to drive.
    if (
      instance.resourceEstateId !== estate.id ||
      !name?.endsWith(suffix) ||
      name.length <= suffix.length
    ) {
      return { status: "not-deployed", estate };
    }
    return { status: "ok", estate, machineApp: name.slice(0, -suffix.length) };
  }

  protected describe(estate: Estate) {
    return {
      id: estate.id,
      slug: estate.slug,
      ...(estate.label ? { label: estate.label } : {}),
      online: this.estateService.isOnline(estate),
      deployAllowed: estate.deployAllowed,
    };
  }
}
