import type {
  EstateController,
  ProjectEstateController,
} from "@lore/deploy/api";
import { $inject, z } from "alepha";
import { $command } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore estate`: the machines a project deploys to, from a shell (#Q2699).
 *
 * `add` creates a Bay estate owned by you, lends it to the current project,
 * and prints the one command to run on the machine. The secret appears in
 * that command once and never again, as on `/account/estates`: there is no
 * way to read it back, only to rotate it from the estate page.
 */
export class EstateCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  protected readonly lending = $client<ProjectEstateController>(
    this.client.scope(),
  );
  protected readonly estates = $client<EstateController>(this.client.scope());

  protected readonly projectFlag = z
    .text({
      aliases: ["p"],
      description:
        "The project, by slug or id. Defaults to LORE_PROJECT, then .alepha/lore.json.",
    })
    .optional();

  public readonly add = $command({
    name: "add",
    description:
      "Create a Bay estate, lend it to the project, and print the command to run on the machine",
    args: z.text({
      title: "slug",
      description: "The estate's name, e.g. vps-ovh",
    }),
    flags: z.object({
      project: this.projectFlag,
      label: z
        .text({ description: "A label shown beside the slug" })
        .optional(),
      "allow-deploys": z
        .boolean()
        .describe(
          "Let Lore deploy to it now. Off by default: a new machine reports stats only until its owner says otherwise.",
        )
        .optional(),
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { project, projectId } = await this.projects.named(
          flags.project,
          context,
        );
        const minted = await this.lending.createProjectEstate({
          params: { projectId },
          body: { slug: args, ...(flags.label ? { label: flags.label } : {}) },
        });
        if (flags["allow-deploys"]) {
          await this.estates.updateEstate({
            params: { estateId: minted.id },
            body: { deployAllowed: true },
          });
        }
        print(`Created estate ${minted.slug} and lent it to ${project}.`);
        print(
          flags["allow-deploys"]
            ? "Deploys are allowed."
            : "Deploys are off until you allow them (lore estate add --allow-deploys, or the estate page).",
        );
        print("");
        print(
          "Run this on the machine, once. The secret is shown here and never again:",
        );
        print("");
        print(
          `  bay connector set ${this.client.hostname()} ${minted.secret ?? "<secret>"}`,
        );
      });
    },
  });

  public readonly list = $command({
    name: "list",
    description: "The estates lent to the project, with their connection state",
    flags: z.object({ project: this.projectFlag, ...LoreOutput.FLAGS }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const { items } = await this.lending.listProjectEstates({
          params: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, items);
          return;
        }
        this.render.list(
          print,
          items.map((estate) => ({
            handle: estate.slug,
            title: estate.label ?? estate.type,
            fields: [
              estate.online ? "online" : "offline",
              estate.deployAllowed ? "deploys allowed" : "deploys off",
              estate.lastSeenAt ? `seen ${estate.lastSeenAt}` : "never seen",
            ],
          })),
          undefined,
          "No estate is lent to this project. Add one with `lore estate add <slug>`.",
        );
      });
    },
  });

  public readonly estate = $command({
    name: "estate",
    description: "The machines this project deploys to: add one, or list them",
    children: [this.add, this.list],
    handler: async ({ help }) => {
      help();
    },
  });
}
