import type {
  EstateController,
  ProjectEstateController,
} from "@lore/deploy/api";
import { $inject, z } from "alepha";
import { $command, UsageError } from "alepha/command";
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
 *
 * `stats` reads a machine's CPU and memory over time (#Q3047): the daily
 * means the estate page charts, from the same owner-only action, so it names
 * one of the caller's own estates by slug and no project.
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
              // The list prints two fields, so the gauge rides on the first.
              [
                estate.online ? "online" : "offline",
                estate.cpuPercent === undefined
                  ? undefined
                  : `CPU ${this.percent(estate.cpuPercent)}`,
                estate.memoryPercent === undefined
                  ? undefined
                  : `RAM ${this.percent(estate.memoryPercent)}`,
              ]
                .filter(Boolean)
                .join(" "),
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

  public readonly stats = $command({
    name: "stats",
    description:
      "One of your estates' CPU and memory: the current reading, then one mean per day",
    args: z.text({
      title: "estate",
      description: "The estate's slug, as lore estate list prints it",
    }),
    flags: z.object({
      since: z
        .text({
          description:
            "The first day to read, as an ISO date. Defaults to 30 days ago.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        // The stats action is the owner's alone, and a slug is unique per
        // owner: the caller's own list is the only place to look it up.
        const { items } = await this.estates.listMyEstates();
        const estate = items.find((item) => item.slug === args);
        if (!estate) {
          throw new UsageError(
            `You own no estate named ${args}. lore estate list shows the project's, and only an estate's owner can read its stats.`,
          );
        }
        const stats = await this.estates.getEstateStats({
          params: { estateId: estate.id },
          query: flags.since ? { since: flags.since } : {},
        });

        if (flags.output === "json") {
          this.render.json(print, {
            ...stats,
            current: {
              cpuPercent: estate.cpuPercent,
              memoryPercent: estate.memoryPercent,
              statsAt: estate.statsAt,
            },
          });
          return;
        }

        this.render.entity(print, {
          fields: [
            ["Estate", estate.slug],
            [
              "Now",
              estate.cpuPercent === undefined ||
              estate.memoryPercent === undefined
                ? "no reading yet"
                : `CPU ${this.percent(estate.cpuPercent)}  RAM ${this.percent(estate.memoryPercent)}  at ${estate.statsAt ?? "?"}`,
            ],
            [
              "Series",
              stats.collecting
                ? "collecting"
                : "off: turn it on from the estate page to keep a history",
            ],
            [
              "Sampled",
              stats.estimated
                ? `yes, 1 in ${stats.sampleInterval ?? "?"}: the means are estimates`
                : undefined,
            ],
          ],
          sections: [
            {
              title: "Daily means",
              lines: stats.points.length
                ? stats.points.map(
                    (point) =>
                      `${point.day}  CPU ${this.percent(point.cpuPercent).padStart(4)}  RAM ${this.percent(point.memoryPercent).padStart(4)}  ${point.samples} samples`,
                  )
                : ["No point in this window."],
            },
          ],
        });
      });
    },
  });

  public readonly estate = $command({
    name: "estate",
    description:
      "The machines this project deploys to: add one, list them, read one's stats",
    children: [this.add, this.list, this.stats],
    handler: async ({ help }) => {
      help();
    },
  });

  protected percent(value: number): string {
    return `${Math.round(value)}%`;
  }
}
