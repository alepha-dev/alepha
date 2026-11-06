import type {
  EstateController,
  ProjectEstateController,
} from "@lore/deploy/api";
import { $inject, AlephaError, z } from "alepha";
import {
  $command,
  CommandError,
  ConsoleInputProvider,
  UsageError,
} from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreEstateResolver } from "../services/LoreEstateResolver.ts";
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
 *
 * `get` and `wait` (#Q3133) read one of the caller's own estates, the second
 * polling until the machine is online, so a script enrolling a new server has
 * something to block on before its first deploy.
 *
 * `update` and `rotate` (#Q3134) change the deploy switch and the label, and
 * mint a new secret, printed once in the shape `add` prints it.
 *
 * `delete` (#Q3131) removes one of the caller's own estates, the end of a
 * throwaway server's life: the server refuses while an app, a stack or a
 * stack environment still deploys to it, and nothing on the machine stops.
 */
export class EstateCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);
  protected readonly owned = $inject(LoreEstateResolver);
  protected readonly input = $inject(ConsoleInputProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * How often `estate wait` reads the estate again. A field so a spec can
   * shorten it; a poll every two seconds for a few minutes is cheap.
   */
  protected pollMillis = 2_000;

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
      ...LoreOutput.FLAGS,
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
        let deployAllowed = minted.deployAllowed ?? false;
        if (flags["allow-deploys"]) {
          const updated = await this.estates.updateEstate({
            params: { estateId: minted.id },
            body: { deployAllowed: true },
          });
          deployAllowed = updated.deployAllowed ?? true;
        }
        if (flags.output === "json") {
          this.render.json(print, this.minted(minted, deployAllowed));
          return;
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
        print(`  ${this.connectorCommand(minted.secret)}`);
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
        // The stats action is the owner's alone: the slug resolves among the
        // caller's own estates.
        const estate = await this.owned.owned(args);
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

  public readonly get = $command({
    name: "get",
    description:
      "One of your estates: whether it is online, when it was last seen, deploys, its loans and what the machine runs",
    args: z.text({
      title: "estate",
      description: "The estate's slug, among the estates you own",
    }),
    flags: z.object({ ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { id } = await this.owned.owned(args);
        const estate = await this.estates.getEstate({
          params: { estateId: id },
        });
        const { inventory } = await this.estates.getEstateInventory({
          params: { estateId: id },
        });
        if (flags.output === "json") {
          this.render.json(print, { ...estate, inventory });
          return;
        }
        this.render.entity(print, {
          fields: [
            ["Estate", estate.slug],
            ["Label", estate.label ?? undefined],
            ["Type", estate.type],
            ["State", estate.online ? "online" : "offline"],
            ["Last seen", estate.lastSeenAt ?? "never"],
            ["Public IP", estate.publicIp ?? "not known yet"],
            ["Deploys", estate.deployAllowed ? "allowed" : "off"],
            [
              "Lent to",
              estate.projects.length
                ? estate.projects
                    .map((project) => project.slug ?? project.title)
                    .join(", ")
                : "no project",
            ],
          ],
          sections: [
            {
              title: "Machine",
              lines: inventory
                ? [
                    `Reported ${inventory.reportedAt}${inventory.bayVersion ? `, Bay ${inventory.bayVersion}` : ""}`,
                    ...inventory.apps.map(
                      (app) =>
                        `${app.app}/${app.env}  ${app.running ? "running" : (app.state ?? "stopped")}${app.domains?.length ? `  ${app.domains.join(" ")}` : ""}`,
                    ),
                    ...(inventory.stacks ?? []).map(
                      (stack) => `${stack.stack}/${stack.env} (stack)`,
                    ),
                  ]
                : [
                    "Never connected: run the connector command on the machine.",
                  ],
            },
          ],
        });
      });
    },
  });

  public readonly wait = $command({
    name: "wait",
    description:
      "Block until one of your estates is online: exit 0 then, exit 1 on timeout",
    args: z.text({
      title: "estate",
      description: "The estate's slug, among the estates you own",
    }),
    flags: z.object({
      timeout: z
        .integer()
        .min(1)
        .describe("How long to wait, in seconds. Default 120.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { id, slug } = await this.owned.owned(args);
        const deadline =
          this.dateTime.nowMillis() + (flags.timeout ?? 120) * 1000;
        let estate = await this.estates.getEstate({
          params: { estateId: id },
        });
        while (!estate.online && this.dateTime.nowMillis() < deadline) {
          await this.dateTime.wait(this.pollMillis);
          estate = await this.estates.getEstate({ params: { estateId: id } });
        }
        if (flags.output === "json") {
          this.render.json(print, estate);
        }
        if (!estate.online) {
          throw new CommandError(
            { exitCode: LoreRefusals.EXIT_FAILURE },
            {
              message: `${slug} is still offline after ${flags.timeout ?? 120}s (last seen ${estate.lastSeenAt ?? "never"}).`,
            },
          );
        }
        if (flags.output !== "json") {
          print(`${slug} is online (last seen ${estate.lastSeenAt ?? "now"}).`);
        }
      });
    },
  });

  public readonly update = $command({
    name: "update",
    description:
      "Change one of your estates: whether it accepts deploys, and its label",
    args: z.text({
      title: "estate",
      description: "The estate's slug, among the estates you own",
    }),
    flags: z.object({
      "allow-deploys": z
        .boolean()
        .describe(
          "Let Lore deploy to it; --no-allow-deploys turns deploys off again",
        )
        .optional(),
      label: z
        .text({ description: "A label shown beside the slug; empty clears it" })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const body = {
          ...(flags["allow-deploys"] === undefined
            ? {}
            : { deployAllowed: flags["allow-deploys"] }),
          ...(flags.label === undefined ? {} : { label: flags.label }),
        };
        if (Object.keys(body).length === 0) {
          throw new UsageError(
            "Nothing to change: pass --allow-deploys, --no-allow-deploys or --label.",
          );
        }
        const { id } = await this.owned.owned(args);
        const updated = await this.estates.updateEstate({
          params: { estateId: id },
          body,
        });
        this.render.written(
          print,
          flags.output,
          updated,
          `Updated ${updated.slug}: deploys ${updated.deployAllowed ? "allowed" : "off"}${updated.label ? `, label "${updated.label}"` : ""}`,
        );
      });
    },
  });

  public readonly rotate = $command({
    name: "rotate",
    description:
      "Mint a new secret for one of your Bay estates and print the connector command once; the old secret stops working at once",
    args: z.text({
      title: "estate",
      description: "The estate's slug, among the estates you own",
    }),
    flags: z.object({
      yes: z.boolean().describe("Do not ask for confirmation (CI)").optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print, ask }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const estate = await this.owned.owned(args);
        await this.confirm(
          ask,
          flags.yes,
          `Rotate the secret of ${estate.slug}? The machine's current secret stops working at once, until you run the new connector command on it.`,
        );
        const rotated = await this.estates.rotateEstate({
          params: { estateId: estate.id },
        });
        if (flags.output === "json") {
          this.render.json(
            print,
            this.minted(rotated, rotated.deployAllowed ?? false),
          );
          return;
        }
        print(`Rotated the secret of ${rotated.slug}.`);
        print("");
        print(
          "Run this on the machine, once. The secret is shown here and never again:",
        );
        print("");
        print(`  ${this.connectorCommand(rotated.secret)}`);
      });
    },
  });

  public readonly delete = $command({
    name: "delete",
    description:
      "Delete one of your estates: Lore forgets the machine and revokes its secret, nothing on the machine stops",
    args: z.text({
      title: "estate",
      description: "The estate's slug, among the estates you own",
    }),
    flags: z.object({
      yes: z.boolean().describe("Do not ask for confirmation (CI)").optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print, ask }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const estate = await this.owned.owned(args);
        await this.confirm(
          ask,
          flags.yes,
          `Delete ${estate.slug}? Lore forgets the machine and revokes its secret; nothing running on it stops.`,
        );
        await this.estates.deleteEstate({ params: { estateId: estate.id } });
        if (flags.output === "json") {
          this.render.json(print, {
            ok: true,
            id: estate.id,
            slug: estate.slug,
            revoked: estate.type === "bay",
          });
          return;
        }
        print(
          `Deleted ${estate.slug}.${estate.type === "bay" ? " Its secret is revoked: the connector holding it is refused on its next dial." : ""}`,
        );
        print(
          "Nothing on the machine was stopped: Lore only lost the connection. Delete the server with its provider when you are done with it.",
        );
      });
    },
  });

  public readonly estate = $command({
    name: "estate",
    description:
      "The machines this project deploys to: add one, list them, read one, wait for it, read its stats, update, rotate or delete it",
    children: [
      this.add,
      this.list,
      this.get,
      this.wait,
      this.stats,
      this.update,
      this.rotate,
      this.delete,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * Ask before an action that cannot be taken back, unless `--yes` was given.
   * A prompt nobody can answer would hang a script, so with no terminal the
   * command refuses instead.
   */
  protected async confirm(
    ask: { confirm: (question: string) => Promise<boolean> },
    yes: boolean | undefined,
    question: string,
  ): Promise<void> {
    if (yes) {
      return;
    }
    if (!this.input.isTTY()) {
      throw new UsageError(
        "This needs a confirmation, and there is no terminal to ask on. Pass --yes.",
      );
    }
    if (!(await ask.confirm(question))) {
      throw new AlephaError("Not confirmed; nothing was changed.");
    }
  }

  /**
   * The line a machine runs to enrol, exactly as every command that mints a
   * secret prints it (`estate add`, `estate rotate`).
   */
  protected connectorCommand(secret: string | undefined): string {
    return `bay connector set ${this.client.hostname()} ${secret ?? "<secret>"}`;
  }

  /**
   * The JSON every command that mints a secret prints (#Q3132): the estate's
   * identity, where it connects, the secret once, and the connector line
   * verbatim, so a script reads `.secret` or runs `.command` with no scraping.
   */
  protected minted(
    estate: { id: string; slug: string; secret?: string },
    deployAllowed: boolean,
  ) {
    return {
      id: estate.id,
      slug: estate.slug,
      deployAllowed,
      lore: this.client.hostname(),
      secret: estate.secret,
      command: this.connectorCommand(estate.secret),
    };
  }

  protected percent(value: number): string {
    return `${Math.round(value)}%`;
  }
}
