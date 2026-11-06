import type { AppController, ProjectEstateController } from "@lore/deploy/api";
import { $inject, z } from "alepha";
import { $command, UsageError } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreEstateChoice } from "../../client/services/LoreEstateChoice.ts";
import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore apps instance list | get | create | update | delete`: the deployed
 * copies a project tracks.
 *
 * ```bash
 * lore apps instance list -p alepha
 * lore apps instance create --app acme --env staging -p alepha
 * lore apps instance update --app acme --env staging --url https://acme.dev
 * ```
 *
 * An instance is the pair `(app, env)`, and both are always named: a guessed
 * environment on a write is how `acem` gets a second copy, the reason
 * `lore apps destroy` refuses to guess too.
 *
 * Named from the MCP tools by the one rule, with `app` read as `apps`, the
 * subject that already exists: `app_instance_list` is `lore apps instance list`.
 *
 * ⚠️ `delete` undeploys nothing, and takes the copy's sigil and everything it
 * reported with it. So it needs `--yes`, a flag and never a prompt: an agent's
 * shell has nothing to answer with.
 *
 * ⚠️ Never re-exported from `index.ts`: the controller types come from the
 * private `lore` workspace.
 */
export class AppInstanceCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly appApi = $client<AppController>(this.client.scope());
  protected readonly estateApi = $client<ProjectEstateController>(
    this.client.scope(),
  );

  /**
   * `--estate <slug>` on create and update (#Q3140): an estate named the way
   * every other command names one, resolved among the estates lent to the
   * project (the list `lore estate list` prints), so an unknown slug names
   * the ones that are.
   */
  protected static readonly ESTATE_FLAG = {
    estate: z
      .text({
        description:
          "Deploy to this estate, by slug, among those lent to the project (lore estate list).",
      })
      .optional(),
  };

  protected static readonly PROJECT_FLAG = {
    project: z
      .text({
        aliases: ["p"],
        description: "The project, by slug or id. Defaults to LORE_PROJECT.",
      })
      .optional(),
  };

  protected static readonly PAIR_FLAGS = {
    app: z.text({ description: "Which app, such as acme." }),
    env: z.text({
      aliases: ["e"],
      description:
        "Which copy of it, such as production. Required: it is never guessed.",
    }),
  };

  public readonly list = $command({
    name: "list",
    description: "Every deployed copy this project tracks, one per (app, env)",
    flags: z.object({
      ...AppInstanceCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const result = await this.appApi.listApps({ params: { projectId } });

        if (flags.output === "json") {
          this.render.json(print, result);
          return;
        }

        this.render.list(
          print,
          result.items.map((instance) => ({
            handle: `${instance.app}/${instance.env}`,
            title: instance.url ?? "",
            fields: [
              instance.sigilId ? "sigil" : undefined,
              instance.estateId ? "estate" : undefined,
            ],
          })),
          undefined,
          "This project tracks no deployed copy yet.",
        );
      });
    },
  });

  public readonly get = $command({
    name: "get",
    description: "One deployed copy, with what it has unlocked",
    flags: z.object({
      ...AppInstanceCommand.PROJECT_FLAG,
      ...AppInstanceCommand.PAIR_FLAGS,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const instance = await this.appApi.getApp({
          params: { projectId, app: flags.app, env: flags.env },
        });

        if (flags.output === "json") {
          this.render.json(print, instance);
          return;
        }

        this.render.entity(print, {
          fields: [
            ["Instance", `${instance.app}/${instance.env}`],
            ["Id", instance.id],
            ["Url", instance.url],
            ["Sigil", instance.sigilId],
            ["Estate", instance.estateId],
          ],
        });
      });
    },
  });

  public readonly create = $command({
    name: "create",
    description:
      "Track a deployed copy. Nothing is minted: lore sigil create adds its key",
    flags: z.object({
      ...AppInstanceCommand.PROJECT_FLAG,
      ...AppInstanceCommand.PAIR_FLAGS,
      url: z
        .text({ description: "Where this copy lives, if already known." })
        .optional(),
      ephemeral: z
        .boolean()
        .describe("A short-lived copy, such as a pull request's preview.")
        .optional(),
      ...AppInstanceCommand.ESTATE_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        // Resolved before anything is created, so an unknown slug leaves no
        // copy behind.
        const estateId =
          flags.estate === undefined
            ? undefined
            : await this.estateIdOf(
                projectId,
                flags.estate,
                `${flags.app}/${flags.env}`,
              );

        const made = await this.appApi.createApp({
          params: { projectId },
          body: {
            app: flags.app,
            env: flags.env,
            ...(flags.url === undefined ? {} : { url: flags.url }),
            ...(flags.ephemeral === undefined
              ? {}
              : { ephemeral: flags.ephemeral }),
          },
        });

        // The create body takes no estate, so it is set the way the Apps
        // page sets it: the update that follows, in the same command.
        const created =
          estateId === undefined
            ? made
            : await this.appApi.updateApp({
                params: { projectId, app: made.app, env: made.env },
                body: { estateId },
              });

        this.render.written(
          print,
          flags.output,
          created,
          `Created ${created.app}/${created.env}${flags.estate ? ` on ${flags.estate}` : ""}`,
        );
      });
    },
  });

  public readonly update = $command({
    name: "update",
    description:
      "Rename either half, pin the address, or point the copy at an estate",
    flags: z.object({
      ...AppInstanceCommand.PROJECT_FLAG,
      ...AppInstanceCommand.PAIR_FLAGS,
      "new-app": z
        .text({
          description:
            "Rename the app half. Both names are the URL, so the page moves; the deployed key does not change.",
        })
        .optional(),
      "new-env": z.text({ description: "Rename the env half." }).optional(),
      url: z
        .text({ description: "Pin the address. An empty string clears it." })
        .optional(),
      "estate-id": z
        .text({
          description:
            "Deploy to this estate, by id, one lent to the project. 0 clears it. --estate names it by slug.",
        })
        .optional(),
      ...AppInstanceCommand.ESTATE_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        if (flags.estate !== undefined && flags["estate-id"] !== undefined) {
          throw new UsageError(
            "Pass --estate (a slug) or --estate-id (an id), not both.",
          );
        }
        const { projectId } = await this.projects.named(flags.project, context);
        const estate =
          flags.estate === undefined
            ? flags["estate-id"]
            : await this.estateIdOf(
                projectId,
                flags.estate,
                `${flags.app}/${flags.env}`,
              );
        const body = {
          ...(flags["new-app"] === undefined ? {} : { app: flags["new-app"] }),
          ...(flags["new-env"] === undefined ? {} : { env: flags["new-env"] }),
          ...(flags.url === undefined ? {} : { url: flags.url }),
          ...(estate === undefined
            ? {}
            : { estateId: estate === "0" ? null : estate }),
        };
        const changed = Object.keys(body);
        if (changed.length === 0) {
          throw new UsageError(
            "Nothing to update: pass at least one of --new-app, --new-env, --url, --estate or --estate-id.",
          );
        }

        const updated = await this.appApi.updateApp({
          params: { projectId, app: flags.app, env: flags.env },
          body,
        });

        this.render.written(
          print,
          flags.output,
          updated,
          `Updated ${updated.app}/${updated.env}: ${changed.join(", ")}`,
        );
      });
    },
  });

  public readonly delete = $command({
    name: "delete",
    description:
      "Forget a deployed copy, its sigil and everything it reported. It undeploys nothing",
    flags: z.object({
      ...AppInstanceCommand.PROJECT_FLAG,
      ...AppInstanceCommand.PAIR_FLAGS,
      yes: z
        .boolean()
        .describe(
          "Required: this deletes the copy's sigil and its analytics, and cannot be undone.",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const pair = `${flags.app}/${flags.env}`;
        if (!flags.yes) {
          throw new UsageError(
            `Nothing deleted: ${pair}, its sigil and everything it reported would go for good. Pass --yes to delete them.`,
          );
        }

        const { projectId } = await this.projects.named(flags.project, context);

        const result = await this.appApi.deleteApp({
          params: { projectId, app: flags.app, env: flags.env },
          // Never `forget`: a copy's resources are destroyed first, the rule
          // `app_instance_delete` follows.
          body: {},
        });

        this.render.written(print, flags.output, result, `Deleted ${pair}`);
      });
    },
  });

  /**
   * A child of `lore apps`, which declares it among its own.
   */
  public readonly instance = $command({
    name: "instance",
    description:
      "The deployed copies this project tracks: list, read, create, update and delete them",
    children: [this.list, this.get, this.create, this.update, this.delete],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * The id of the estate `slug` names among those lent to the project,
   * through the one rule every creator of a copy shares.
   */
  protected async estateIdOf(
    projectId: number,
    slug: string,
    copy: string,
  ): Promise<string> {
    const { items } = await this.estateApi.listProjectEstates({
      params: { projectId },
    });
    return LoreEstateChoice.pick(items, slug, copy).id;
  }
}
