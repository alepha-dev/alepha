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
import { LoreEstateProvisioner } from "../services/LoreEstateProvisioner.ts";
import { LoreEstateResolver } from "../services/LoreEstateResolver.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";
import { EstateProviders } from "../services/providers/EstateProviders.ts";

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
  protected readonly providers = $inject(EstateProviders);
  protected readonly provisioner = $inject(LoreEstateProvisioner);

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
      ttl: z
        .text({
          description:
            "How long the server is meant to live (30m, 2h, 3d): past it the estate shows overdue and you are told once. Lore stops nothing",
        })
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
        const ttlSeconds =
          flags.ttl === undefined ? undefined : this.ttlSecondsOf(flags.ttl);
        if (flags["allow-deploys"] || typeof ttlSeconds === "number") {
          const updated = await this.estates.updateEstate({
            params: { estateId: minted.id },
            body: {
              ...(flags["allow-deploys"] ? { deployAllowed: true } : {}),
              ...(typeof ttlSeconds === "number" ? { ttlSeconds } : {}),
            },
          });
          deployAllowed = updated.deployAllowed ?? deployAllowed;
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

  /**
   * `lore estate provision` (#Q3166, epic E116): buys a server from a
   * provider through the provider's own CLI, enrols it through cloud-init
   * with a one-time secret, and waits until it is online. No project is
   * needed: the estate is the caller's, lent with `--project` (created when
   * missing) or later with `lore estate lend`.
   */
  public readonly provision = $command({
    name: "provision",
    description:
      "Buy a server from a cloud provider, install Bay on it and enrol it as one of your estates; waits until it is online",
    flags: z.object({
      provider: z
        .text({
          description:
            "Where to buy the server (scaleway). Omit it to list the providers and what each needs",
        })
        .optional(),
      name: z
        .text({
          description:
            "The estate's slug. Default: three random words, e.g. small-skilled-pie",
        })
        .optional(),
      project: z
        .text({
          aliases: ["p"],
          description:
            "Lend the estate to this project, created when it does not exist. Default: lent to none",
        })
        .optional(),
      type: z
        .text({
          description: "The server type. Default: the provider's (DEV1-S)",
        })
        .optional(),
      zone: z
        .text({ description: "The zone. Default: the provider's (fr-par-1)" })
        .optional(),
      "allow-deploys": z
        .boolean()
        .describe(
          "Accept deploys (on by default: a provisioned server exists to be deployed to); --no-allow-deploys for stats only",
        )
        .optional(),
      timeout: z
        .integer()
        .min(1)
        .describe(
          "How long to wait for the server to come online, in seconds. Default 300.",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const provider = this.providers.pick(flags.provider);
        const json = flags.output === "json";
        const done = await this.provisioner.provision(
          {
            provider,
            ...(flags.name ? { name: flags.name } : {}),
            ...(flags.project ? { project: flags.project } : {}),
            type: flags.type ?? provider.defaults.type,
            zone: flags.zone ?? provider.defaults.zone,
            deployAllowed: flags["allow-deploys"] ?? true,
            timeoutSeconds: flags.timeout ?? 300,
          },
          json ? () => {} : print,
        );
        if (json) {
          this.render.json(print, done);
        }
        if (!done.online) {
          throw new CommandError(
            { exitCode: LoreRefusals.EXIT_FAILURE },
            {
              message: `${done.slug} is not online after ${flags.timeout ?? 300}s. The server ${done.serverId} is kept and still billing. Wait longer with: lore estate wait ${done.slug} --timeout 300. Or remove it: lore estate delete ${done.slug} --yes`,
            },
          );
        }
        if (json) {
          return;
        }
        print("");
        print(`${done.slug} is online.`);
        print(
          `  server   ${done.serverId} (${done.type}, ${done.zone}, ${done.provider})`,
        );
        print(
          `  address  ${done.publicIp}, apps under https://<app>.${done.baseDomain}`,
        );
        if (done.hourlyPrice !== undefined) {
          print(
            `  price    about EUR ${done.hourlyPrice.toFixed(4)} an hour, billed until you delete it`,
          );
        }
        print(
          `  deploys  ${done.deployAllowed ? "allowed" : "off (stats only)"}`,
        );
        print("");
        if (done.project) {
          print(`Lent to ${done.project}. Next, in an app of that project:`);
          print(
            `  alepha init ${done.project} --infra lore   (or an existing app linked to it)`,
          );
          print("  alepha deploy");
        } else {
          print(
            "Lent to no project. Lend it to one, then deploy from an app of that project:",
          );
          print(`  lore estate lend ${done.slug} --project <project>`);
          print("  alepha deploy");
        }
        print("");
        print(
          `When you are done: lore estate delete ${done.slug} --yes (terminates the server, its IP and its disk)`,
        );
      });
    },
  });

  /**
   * `lore estate lend` / `unlend` (#Q3172): an estate is its owner's, and a
   * provisioned one may be lent to no project; these lend it to one later,
   * or withdraw the loan. Unlending is refused while a copy of the project
   * still deploys there, and the refusal names the copies.
   */
  public readonly lend = $command({
    name: "lend",
    description:
      "Lend one of your estates to a project, so its apps can deploy there",
    args: z.text({
      title: "estate",
      description: "The estate's slug, among the estates you own",
    }),
    flags: z.object({ project: this.projectFlag, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const estate = await this.owned.owned(args);
        const { project, projectId } = await this.projects.named(
          flags.project,
          context,
        );
        const lent = await this.lending.attachEstate({
          params: { projectId },
          body: { estateId: estate.id },
        });
        if (flags.output === "json") {
          this.render.json(print, lent);
          return;
        }
        print(`Lent ${estate.slug} to ${project}.`);
        print(
          "Its apps deploy there: alepha deploy (in an app linked to the project).",
        );
      });
    },
  });

  public readonly unlend = $command({
    name: "unlend",
    description:
      "Withdraw one of your estates from a project; refused while a copy there still deploys to it",
    args: z.text({
      title: "estate",
      description: "The estate's slug, among the estates you own",
    }),
    flags: z.object({ project: this.projectFlag, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const estate = await this.owned.owned(args);
        const { project, projectId } = await this.projects.named(
          flags.project,
          context,
        );
        await this.lending.detachEstate({
          params: { projectId, estateId: estate.id },
        });
        if (flags.output === "json") {
          this.render.json(print, { ok: true, slug: estate.slug, project });
          return;
        }
        print(`${estate.slug} is no longer lent to ${project}.`);
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
              [
                estate.deployAllowed ? "deploys allowed" : "deploys off",
                estate.provider
                  ? `${estate.provider} ${estate.providerServerType ?? ""}`.trim()
                  : undefined,
                estate.overdue ? "OVERDUE" : undefined,
              ]
                .filter(Boolean)
                .join(", "),
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
            [
              // A server lore estate provision bought (#Q3168).
              "Server",
              estate.providerServerId
                ? `${estate.providerServerId} (${[estate.providerServerType, estate.providerZone, estate.provider].filter(Boolean).join(", ")})`
                : undefined,
            ],
            ["Cost", this.costLine(estate)],
            [
              "Expires",
              estate.expiresAt
                ? `${estate.expiresAt}${estate.overdue ? " (OVERDUE: delete the server, or extend with --ttl)" : ""}`
                : undefined,
            ],
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
      ttl: z
        .text({
          description:
            "Extend the expiry to this long from now (30m, 2h, 3d), or none to clear it",
        })
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
          ...(flags.ttl === undefined
            ? {}
            : { ttlSeconds: this.ttlSecondsOf(flags.ttl) }),
        };
        if (Object.keys(body).length === 0) {
          throw new UsageError(
            "Nothing to change: pass --allow-deploys, --no-allow-deploys, --label or --ttl.",
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
          `Updated ${updated.slug}: deploys ${updated.deployAllowed ? "allowed" : "off"}${updated.label ? `, label "${updated.label}"` : ""}${updated.expiresAt ? `, expires ${updated.expiresAt}` : ""}`,
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

  /**
   * `lore estate delete` (#Q3131), which also terminates a provisioned
   * server with its IP and its disk (#Q3167). Lore holds no provider key, so
   * the CLI terminates through the provider's own CLI, in an order that
   * never loses a billing server: Lore is asked first whether it would
   * accept the delete, then the server is terminated, then the row goes. A
   * terminate that fails keeps the row and prints the command that finishes.
   */
  public readonly delete = $command({
    name: "delete",
    description:
      "Delete one of your estates: a server provision bought is terminated with its IP and disk; for one added by hand, Lore forgets the machine and nothing on it stops",
    args: z.text({
      title: "estate",
      description: "The estate's slug, among the estates you own",
    }),
    flags: z.object({
      yes: z.boolean().describe("Do not ask for confirmation (CI)").optional(),
      "keep-server": z
        .boolean()
        .describe(
          "For a provisioned estate: delete it in Lore and leave the server running (and billing)",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print, ask }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const estate = await this.owned.owned(args);
        const server =
          estate.provider && estate.providerServerId && estate.providerZone
            ? {
                provider: estate.provider,
                id: estate.providerServerId,
                zone: estate.providerZone,
              }
            : undefined;
        const terminate = server !== undefined && !flags["keep-server"];
        const provider = terminate
          ? this.providers.pick(server.provider)
          : undefined;
        if (provider) {
          await provider.check();
          // Refused here, before the server goes, when Lore would refuse the
          // delete itself: a copy or a stack still deploying there.
          await this.estates.checkEstateDeletable({
            params: { estateId: estate.id },
          });
        }

        await this.confirm(
          ask,
          flags.yes,
          terminate
            ? `Delete ${estate.slug} and terminate its server ${server.id} on ${server.provider}, with its IP and its disk? This cannot be undone.`
            : `Delete ${estate.slug}? Lore forgets the machine and revokes its secret; nothing running on it stops.`,
        );

        if (provider && server) {
          try {
            await provider.terminate(server.id, server.zone);
          } catch (error) {
            const reason =
              error instanceof Error ? error.message : String(error);
            throw new CommandError(
              { exitCode: LoreRefusals.EXIT_FAILURE },
              {
                message: `Could not terminate ${server.id} (${reason}). ${estate.slug} is kept so the server stays visible. Terminate it with:\n  ${provider.terminateCommand(server.id, server.zone)}\nthen: lore estate delete ${estate.slug} --keep-server --yes`,
              },
            );
          }
        }

        await this.estates.deleteEstate({ params: { estateId: estate.id } });
        if (flags.output === "json") {
          this.render.json(print, {
            ok: true,
            id: estate.id,
            slug: estate.slug,
            revoked: estate.type === "bay",
            ...(server ? { server: server.id, terminated: terminate } : {}),
          });
          return;
        }
        if (terminate) {
          print(
            `Deleted ${estate.slug} and terminated its server ${server.id}, with its IP and its disk.`,
          );
          return;
        }
        print(
          `Deleted ${estate.slug}.${estate.type === "bay" ? " Its secret is revoked: the connector holding it is refused on its next dial." : ""}`,
        );
        if (server) {
          print(
            `Its server ${server.id} is still running on ${server.provider}, and billing. Terminate it with: ${this.providers.pick(server.provider).terminateCommand(server.id, server.zone)}`,
          );
          return;
        }
        print(
          "Nothing on the machine was stopped: Lore only lost the connection. Delete the server with its provider when you are done with it.",
        );
      });
    },
  });

  public readonly estate = $command({
    name: "estate",
    description:
      "The machines your projects deploy to: provision a server, add one by hand, list them, read one, wait for it, read its stats, lend or unlend it, update, rotate or delete it",
    children: [
      this.provision,
      this.add,
      this.list,
      this.get,
      this.wait,
      this.stats,
      this.lend,
      this.unlend,
      this.update,
      this.rotate,
      this.delete,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * A TTL as `lore estate add --ttl` takes it (#Q3138): a number and a unit,
   * `m`, `h` or `d` (`30m`, `2h`, `3d`), or `none` to clear the expiry.
   */
  protected ttlSecondsOf(raw: string): number | null {
    const value = raw.trim().toLowerCase();
    if (value === "none") {
      return null;
    }
    const match = /^(\d+)\s*([mhd])$/.exec(value);
    if (!match) {
      throw new UsageError(
        `--ttl ${raw}: write a number and m, h or d (30m, 2h, 3d), or none.`,
      );
    }
    const unit = { m: 60, h: 3_600, d: 86_400 }[match[2] as "m" | "h" | "d"];
    const seconds = Number(match[1]) * unit;
    if (seconds < 60 || seconds > 366 * 86_400) {
      throw new UsageError(`--ttl ${raw}: between 1m and 366d.`);
    }
    return seconds;
  }

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

  /**
   * A provisioned server's price and what it has cost so far (#Q3168): the
   * stored hourly price times the hours since it was provisioned, said as an
   * estimate since the provider bills by its own rules.
   */
  protected costLine(estate: {
    hourlyPrice?: number;
    provisionedAt?: string;
  }): string | undefined {
    if (estate.hourlyPrice === undefined || !estate.provisionedAt) {
      return undefined;
    }
    const hours = Math.max(
      0,
      (this.dateTime.nowMillis() - Date.parse(estate.provisionedAt)) /
        3_600_000,
    );
    return `about EUR ${estate.hourlyPrice.toFixed(4)} an hour, about EUR ${(estate.hourlyPrice * hours).toFixed(2)} so far (estimate), until lore estate delete terminates it`;
  }

  protected percent(value: number): string {
    return `${Math.round(value)}%`;
  }
}
