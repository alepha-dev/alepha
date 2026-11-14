import type {
  AdminHostController,
  HostController,
  ProjectHostController,
} from "@lore/deploy/api";
import { $inject, AlephaError, z } from "alepha";
import {
  $command,
  CommandError,
  ConsoleInputProvider,
  UsageError,
} from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { isHttpError } from "alepha/server";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreHostProvisioner } from "../services/LoreHostProvisioner.ts";
import { LoreHostResolver } from "../services/LoreHostResolver.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";
import { HostProviders } from "../services/providers/HostProviders.ts";

/**
 * `lore host`: the machines a project deploys to, from a shell (#Q2699).
 *
 * A host belongs to a project, its home, whose members manage it by their
 * rank, and is lent to the projects that deploy onto it (epic #E126). A slug
 * is unique inside a home project, so `LoreHostResolver` resolves it: a
 * managing verb (`update`, `rotate`, `delete`, `move`) among the hosts the
 * project is the home of, a reading verb (`get`, `wait`, `stats`) and `lend`
 * among the hosts the caller can read, with `--home` for two of one name.
 *
 * `add` creates a Bay host in the current project, lends it there, and
 * prints the one command to run on the machine. The secret appears in that
 * command once and never again: there is no way to read it back, only to
 * rotate it.
 *
 * `stats` reads a machine's CPU and memory over time (#Q3047), `get` and
 * `wait` (#Q3133) read one host, the second polling until it is online.
 * `update` and `rotate` (#Q3134) change the deploy switch and the label, and
 * mint a new secret. `delete` (#Q3131) removes one: refused while an app or a
 * stack still deploys to it, and nothing on the machine stops. `move`
 * (#Q3282) gives it another home, and `assign` is the instance admin's, for
 * a host with no home.
 */
export class HostCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);
  protected readonly owned = $inject(LoreHostResolver);
  protected readonly input = $inject(ConsoleInputProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly providers = $inject(HostProviders);
  protected readonly provisioner = $inject(LoreHostProvisioner);

  /**
   * How often `host wait` reads the host again. A field so a spec can
   * shorten it; a poll every two seconds for a few minutes is cheap.
   */
  protected pollMillis = 2_000;

  protected readonly lending = $client<ProjectHostController>(
    this.client.scope(),
  );
  protected readonly hosts = $client<HostController>(this.client.scope());
  protected readonly admin = $client<AdminHostController>(this.client.scope());

  protected readonly projectFlag = z
    .text({
      aliases: ["p"],
      description:
        "The project, by slug or id. Defaults to LORE_PROJECT, then .alepha/lore.json.",
    })
    .optional();

  protected readonly homeFlag = z
    .text({
      description:
        "The host's home project, by slug, when two hosts the command could mean share one slug",
    })
    .optional();

  /**
   * The project a reading verb narrows to, when there is one: `-p`, then
   * `LORE_PROJECT`, then `.alepha/lore.json`. None is not an error here: the
   * slug then resolves among every host the caller can read.
   */
  protected async optionalProject(
    flag: string | undefined,
    context: LoreRefusalContext,
  ): Promise<number | undefined> {
    try {
      return (await this.projects.named(flag, context)).projectId;
    } catch (error) {
      if (error instanceof UsageError) {
        return undefined;
      }
      throw error;
    }
  }

  public readonly add = $command({
    name: "add",
    description:
      "Create a Bay host, lend it to the project, and print the command to run on the machine",
    args: z.text({
      title: "slug",
      description: "The host's name, e.g. vps-ovh",
    }),
    flags: z.object({
      project: this.projectFlag,
      label: z
        .text({ description: "A label shown beside the slug" })
        .optional(),
      "allow-deploys": z
        .boolean()
        .describe(
          "Let Lore deploy to it now. Off by default: a new machine reports stats only until somebody who manages it says otherwise.",
        )
        .optional(),
      ttl: z
        .text({
          description:
            "How long the server is meant to live (30m, 2h, 3d): past it the host shows overdue and you are told once. Lore stops nothing",
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
        const minted = await this.lending.createProjectHost({
          params: { projectId },
          body: { slug: args, ...(flags.label ? { label: flags.label } : {}) },
        });
        let deployAllowed = minted.deployAllowed ?? false;
        const ttlSeconds =
          flags.ttl === undefined ? undefined : this.ttlSecondsOf(flags.ttl);
        if (flags["allow-deploys"] || typeof ttlSeconds === "number") {
          const updated = await this.hosts.updateHost({
            params: { hostId: minted.id },
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
        print(`Created host ${minted.slug} in ${project}, and lent it there.`);
        print(
          flags["allow-deploys"]
            ? "Deploys are allowed."
            : "Deploys are off until you allow them (lore host add --allow-deploys, or the host page).",
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
   * `lore host provision` (#Q3166, epic E116): buys a server from a
   * provider through the provider's own CLI, enrols it through cloud-init
   * with a one-time secret, and waits until it is online. The host belongs
   * to `--project` (created when missing), which is required: a host
   * belongs to a project (#E126).
   */
  public readonly provision = $command({
    name: "provision",
    description:
      "Buy a server from a cloud provider, install Bay on it and enrol it as a host of a project; waits until it is online",
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
            "The host's slug. Default: three random words, e.g. small-skilled-pie",
        })
        .optional(),
      project: z
        .text({
          aliases: ["p"],
          description:
            "The project the host belongs to, created with Apps on when it does not exist. Required",
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
              message: `${done.slug} is not online after ${flags.timeout ?? 300}s. The server ${done.serverId} is kept and still billing. Wait longer with: lore host wait ${done.slug} --timeout 300. Or remove it: lore host delete ${done.slug} --yes`,
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
        print(
          `It belongs to ${done.project}, and is lent there. Next, in an app of that project:`,
        );
        print(
          `  alepha init ${done.project} --infra lore   (or an existing app linked to it)`,
        );
        print("  alepha deploy");
        print("");
        print(
          `When you are done: lore host delete ${done.slug} --yes (terminates the server, its IP and its disk)`,
        );
      });
    },
  });

  /**
   * `lore host lend` / `unlend` (#Q3172): lend a host to another project,
   * so its apps can deploy there, or withdraw the loan. Lending takes
   * `host:lend` in the host's home project and in the borrowing one.
   * Unlending is refused while a copy of the project still deploys there,
   * and the refusal names the copies.
   */
  public readonly lend = $command({
    name: "lend",
    description:
      "Lend a host to a project, so its apps can deploy there; needs host:lend on both sides",
    args: z.text({
      title: "host",
      description:
        "The host's slug, among the hosts you may lend (--home when two share it)",
    }),
    flags: z.object({
      project: this.projectFlag,
      home: this.homeFlag,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { project, projectId } = await this.projects.named(
          flags.project,
          context,
        );
        const host = await this.owned.readable(args, {
          ...(flags.home ? { home: flags.home } : {}),
          need: "host:lend",
        });
        const lent = await this.lending.attachHost({
          params: { projectId },
          body: { hostId: host.id },
        });
        if (flags.output === "json") {
          this.render.json(print, lent);
          return;
        }
        print(`Lent ${host.slug} to ${project}.`);
        print(
          "Its apps deploy there: alepha deploy (in an app linked to the project).",
        );
      });
    },
  });

  public readonly unlend = $command({
    name: "unlend",
    description:
      "Withdraw a host's loan to a project; refused while a copy there still deploys to it",
    args: z.text({
      title: "host",
      description:
        "The host's slug, among the hosts lent to the project (--home when two share it)",
    }),
    flags: z.object({
      project: this.projectFlag,
      home: this.homeFlag,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { project, projectId } = await this.projects.named(
          flags.project,
          context,
        );
        const { items } = await this.lending.listProjectHosts({
          params: { projectId },
        });
        const home = flags.home?.toLowerCase();
        const matching = items.filter(
          (item) =>
            item.slug === args &&
            (!home ||
              item.home?.slug?.toLowerCase() === home ||
              item.home?.title.toLowerCase() === home),
        );
        if (matching.length === 0) {
          throw new UsageError(
            `No host named ${args} is lent to ${project}. lore host list shows the ones that are.`,
          );
        }
        if (matching.length > 1) {
          throw new UsageError(
            `Several hosts named ${args} are lent to ${project}, from ${matching
              .map((item) => item.home?.slug ?? item.home?.title ?? "?")
              .join(", ")}. Choose one with --home <project>.`,
          );
        }
        const host = matching[0]!;
        await this.lending.detachHost({
          params: { projectId, hostId: host.id },
        });
        if (flags.output === "json") {
          this.render.json(print, { ok: true, slug: host.slug, project });
          return;
        }
        print(`${host.slug} is no longer lent to ${project}.`);
      });
    },
  });

  public readonly list = $command({
    name: "list",
    description:
      "The hosts the project can deploy onto, with whether it is their home or borrows them, and their connection state",
    flags: z.object({ project: this.projectFlag, ...LoreOutput.FLAGS }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const { items } = await this.lending.listProjectHosts({
          params: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, items);
          return;
        }
        this.render.list(
          print,
          items.map((host) => ({
            handle: host.slug,
            // Whether the project is its home or borrows it, and from whom.
            title: `${host.label ?? host.type}, ${
              host.isHome
                ? "home"
                : `borrowed from ${host.home?.slug ?? host.home?.title ?? "no project"}`
            }`,
            fields: [
              // The list prints two fields, so the gauge rides on the first.
              [
                host.online ? "online" : "offline",
                host.cpuPercent === undefined
                  ? undefined
                  : `CPU ${this.percent(host.cpuPercent)}`,
                host.memoryPercent === undefined
                  ? undefined
                  : `RAM ${this.percent(host.memoryPercent)}`,
              ]
                .filter(Boolean)
                .join(" "),
              [
                host.deployAllowed ? "deploys allowed" : "deploys off",
                host.provider
                  ? `${host.provider} ${host.providerServerType ?? ""}`.trim()
                  : undefined,
                host.overdue ? "OVERDUE" : undefined,
              ]
                .filter(Boolean)
                .join(", "),
              host.lastSeenAt ? `seen ${host.lastSeenAt}` : "never seen",
            ],
          })),
          undefined,
          "No host is lent to this project. Add one with `lore host add <slug>`, or borrow one with `lore host lend <slug> --project <this project>`.",
        );
      });
    },
  });

  public readonly stats = $command({
    name: "stats",
    description:
      "A host's CPU and memory: the current reading, then one mean per day",
    args: z.text({
      title: "host",
      description: "The host's slug, as lore host list prints it",
    }),
    flags: z.object({
      project: this.projectFlag,
      home: this.homeFlag,
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
        // `host:read` in the host's home project: the slug resolves among
        // the hosts the caller can read, narrowed to the project's.
        const host = await this.owned.readable(args, {
          ...(await this.readScope(flags.project, flags.home, context)),
        });
        const stats = await this.hosts.getHostStats({
          params: { hostId: host.id },
          query: flags.since ? { since: flags.since } : {},
        });

        if (flags.output === "json") {
          this.render.json(print, {
            ...stats,
            current: {
              cpuPercent: host.cpuPercent,
              memoryPercent: host.memoryPercent,
              statsAt: host.statsAt,
            },
          });
          return;
        }

        this.render.entity(print, {
          fields: [
            ["Host", host.slug],
            [
              "Now",
              host.cpuPercent === undefined || host.memoryPercent === undefined
                ? "no reading yet"
                : `CPU ${this.percent(host.cpuPercent)}  RAM ${this.percent(host.memoryPercent)}  at ${host.statsAt ?? "?"}`,
            ],
            [
              "Series",
              stats.collecting
                ? "collecting"
                : "off: turn it on from the host page to keep a history",
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
      "A host: its home project, whether it is online, when it was last seen, deploys, its loans and what the machine runs",
    args: z.text({
      title: "host",
      description:
        "The host's slug, among the hosts you can read (--home when two share it)",
    }),
    flags: z.object({
      project: this.projectFlag,
      home: this.homeFlag,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { id } = await this.owned.readable(
          args,
          await this.readScope(flags.project, flags.home, context),
        );
        const host = await this.hosts.getHost({
          params: { hostId: id },
        });
        const { inventory } = await this.hosts.getHostInventory({
          params: { hostId: id },
        });
        if (flags.output === "json") {
          this.render.json(print, { ...host, inventory });
          return;
        }
        this.render.entity(print, {
          fields: [
            ["Host", host.slug],
            ["Home", host.project?.slug ?? host.project?.title ?? "none"],
            ["Added by", host.creator?.name],
            ["Label", host.label ?? undefined],
            ["Type", host.type],
            ["State", host.online ? "online" : "offline"],
            ["Last seen", host.lastSeenAt ?? "never"],
            ["Public IP", host.publicIp ?? "not known yet"],
            [
              // A server lore host provision bought (#Q3168).
              "Server",
              host.providerServerId
                ? `${host.providerServerId} (${[host.providerServerType, host.providerZone, host.provider].filter(Boolean).join(", ")})`
                : undefined,
            ],
            ["Cost", this.costLine(host)],
            [
              "Expires",
              host.expiresAt
                ? `${host.expiresAt}${host.overdue ? " (OVERDUE: delete the server, or extend with --ttl)" : ""}`
                : undefined,
            ],
            ["Deploys", host.deployAllowed ? "allowed" : "off"],
            [
              "Lent to",
              host.projects.length
                ? host.projects
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
    description: "Block until a host is online: exit 0 then, exit 1 on timeout",
    args: z.text({
      title: "host",
      description:
        "The host's slug, among the hosts you can read (--home when two share it)",
    }),
    flags: z.object({
      project: this.projectFlag,
      home: this.homeFlag,
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
        const { id, slug } = await this.owned.readable(
          args,
          await this.readScope(flags.project, flags.home, context),
        );
        const deadline =
          this.dateTime.nowMillis() + (flags.timeout ?? 120) * 1000;
        let host = await this.hosts.getHost({
          params: { hostId: id },
        });
        while (!host.online && this.dateTime.nowMillis() < deadline) {
          await this.dateTime.wait(this.pollMillis);
          host = await this.hosts.getHost({ params: { hostId: id } });
        }
        if (flags.output === "json") {
          this.render.json(print, host);
        }
        if (!host.online) {
          throw new CommandError(
            { exitCode: LoreRefusals.EXIT_FAILURE },
            {
              message: `${slug} is still offline after ${flags.timeout ?? 120}s (last seen ${host.lastSeenAt ?? "never"}).`,
            },
          );
        }
        if (flags.output !== "json") {
          print(`${slug} is online (last seen ${host.lastSeenAt ?? "now"}).`);
        }
      });
    },
  });

  public readonly update = $command({
    name: "update",
    description:
      "Change a host of the project: whether it accepts deploys, its label and its expiry",
    args: z.text({
      title: "host",
      description:
        "The host's slug, among the hosts the project is the home of",
    }),
    flags: z.object({
      project: this.projectFlag,
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
        const { project, projectId } = await this.projects.named(
          flags.project,
          context,
        );
        const { id } = await this.owned.managed(args, projectId, project);
        const updated = await this.hosts.updateHost({
          params: { hostId: id },
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
      "Mint a new secret for a Bay host of the project and print the connector command once; the old secret stops working at once",
    args: z.text({
      title: "host",
      description:
        "The host's slug, among the hosts the project is the home of",
    }),
    flags: z.object({
      project: this.projectFlag,
      yes: z.boolean().describe("Do not ask for confirmation (CI)").optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print, ask }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { project, projectId } = await this.projects.named(
          flags.project,
          context,
        );
        const host = await this.owned.managed(args, projectId, project);
        await this.confirm(
          ask,
          flags.yes,
          `Rotate the secret of ${host.slug}? The machine's current secret stops working at once, until you run the new connector command on it.`,
        );
        const rotated = await this.hosts.rotateHost({
          params: { hostId: host.id },
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
   * `lore host delete` (#Q3131), which also terminates a provisioned
   * server with its IP and its disk (#Q3167). Lore holds no provider key, so
   * the CLI terminates through the provider's own CLI, in an order that
   * never loses a billing server: Lore is asked first whether it would
   * accept the delete, then the server is terminated, then the row goes. A
   * terminate that fails keeps the row and prints the command that finishes.
   */
  public readonly delete = $command({
    name: "delete",
    description:
      "Delete a host of the project: a server provision bought is terminated with its IP and disk; for one added by hand, Lore forgets the machine and nothing on it stops. Never a host the project only borrows",
    args: z.text({
      title: "host",
      description:
        "The host's slug, among the hosts the project is the home of",
    }),
    flags: z.object({
      project: this.projectFlag,
      yes: z.boolean().describe("Do not ask for confirmation (CI)").optional(),
      "keep-server": z
        .boolean()
        .describe(
          "For a provisioned host: delete it in Lore and leave the server running (and billing)",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print, ask }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { project, projectId } = await this.projects.named(
          flags.project,
          context,
        );
        const host = await this.owned.managed(args, projectId, project);
        const server =
          host.provider && host.providerServerId && host.providerZone
            ? {
                provider: host.provider,
                id: host.providerServerId,
                zone: host.providerZone,
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
          await this.referencedHint(() =>
            this.hosts.checkHostDeletable({
              params: { hostId: host.id },
            }),
          );
        }

        await this.confirm(
          ask,
          flags.yes,
          terminate
            ? `Delete ${host.slug} and terminate its server ${server.id} on ${server.provider}, with its IP and its disk? This cannot be undone.`
            : `Delete ${host.slug}? Lore forgets the machine and revokes its secret; nothing running on it stops.`,
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
                message: `Could not terminate ${server.id} (${reason}). ${host.slug} is kept so the server stays visible. Terminate it with:\n  ${provider.terminateCommand(server.id, server.zone)}\nthen: lore host delete ${host.slug} --keep-server --yes`,
              },
            );
          }
        }

        await this.referencedHint(() =>
          this.hosts.deleteHost({ params: { hostId: host.id } }),
        );
        if (flags.output === "json") {
          this.render.json(print, {
            ok: true,
            id: host.id,
            slug: host.slug,
            revoked: host.type === "bay",
            ...(server ? { server: server.id, terminated: terminate } : {}),
          });
          return;
        }
        if (terminate) {
          print(
            `Deleted ${host.slug} and terminated its server ${server.id}, with its IP and its disk.`,
          );
          return;
        }
        print(
          `Deleted ${host.slug}.${host.type === "bay" ? " Its secret is revoked: the connector holding it is refused on its next dial." : ""}`,
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

  /**
   * `lore host move` (#Q3282): give a host of the project another home.
   * Takes `host:delete` here and `host:create` in the target; the slug,
   * the machine and every loan stay, and the loans that stay are printed.
   */
  public readonly move = $command({
    name: "move",
    description:
      "Move a host of the project to another project; its slug, its machine and its loans stay",
    args: z.text({
      title: "host",
      description:
        "The host's slug, among the hosts the project is the home of",
    }),
    flags: z.object({
      project: this.projectFlag,
      to: z.text({ description: "The project it moves to, by slug or id" }),
      yes: z.boolean().describe("Do not ask for confirmation (CI)").optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print, ask }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { project, projectId } = await this.projects.named(
          flags.project,
          context,
        );
        const host = await this.owned.managed(args, projectId, project);
        const targetId = await this.projects.resolve(flags.to);
        await this.confirm(
          ask,
          flags.yes,
          `Move ${host.slug} from ${project} to ${flags.to}? The members of ${flags.to} will manage it, by their rank.`,
        );
        const result = await this.hosts.moveHost({
          params: { hostId: host.id },
          body: { projectId: targetId },
        });
        if (flags.output === "json") {
          this.render.json(print, result);
          return;
        }
        print(`Moved ${host.slug} to ${flags.to}.`);
        print(
          result.loans.length
            ? `Still lent to: ${result.loans.map((loan) => loan.slug ?? loan.title).join(", ")}.`
            : "It is lent to no project.",
        );
        if (result.serverElsewhere) {
          print(
            "Its server stays in the cloud account of whoever provisioned it, who is not a member of the new project.",
          );
        }
      });
    },
  });

  /**
   * `lore host assign` (#Q3282): the instance admin's verb, for a host
   * with no home, which has no project to resolve a slug in, so it is named
   * by id (the admin's hosts page shows it). Its loans do not change.
   */
  public readonly assign = $command({
    name: "assign",
    description:
      "For an instance admin: give a host a home project, by its id; its loans do not change",
    args: z.text({
      title: "host",
      description: "The host's id, as the admin's hosts page shows it",
    }),
    flags: z.object({
      to: z.text({ description: "The project it gets as its home" }),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = { project: flags.to };
      await this.refusals.guard(context, async () => {
        const projectId = await this.projects.resolve(flags.to);
        const result = await this.admin.assignHost({
          params: { id: args },
          body: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, result);
          return;
        }
        print(
          `The host now belongs to ${result.project.slug ?? result.project.title}.`,
        );
        print(
          result.loans.length
            ? `Still lent to: ${result.loans.map((loan) => loan.slug ?? loan.title).join(", ")}.`
            : "It is lent to no project.",
        );
      });
    },
  });

  public readonly host = $command({
    name: "host",
    description:
      "The machines your projects deploy to: provision a server, add one by hand, list them, read one, wait for it, read its stats, lend or unlend it, update, rotate, move or delete it, and, for an admin, assign one",
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
      this.move,
      this.delete,
      this.assign,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * What a reading verb narrows a slug by: the project when one is known,
   * and `--home`.
   */
  protected async readScope(
    projectFlag: string | undefined,
    home: string | undefined,
    context: LoreRefusalContext,
  ): Promise<{ projectId?: number; home?: string }> {
    const projectId = await this.optionalProject(projectFlag, context);
    return {
      ...(projectId === undefined ? {} : { projectId }),
      ...(home ? { home } : {}),
    };
  }

  /**
   * A TTL as `lore host add --ttl` takes it (#Q3138): a number and a unit,
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
   * secret prints it (`host add`, `host rotate`).
   */
  protected connectorCommand(secret: string | undefined): string {
    return `bay connector set ${this.client.hostname()} ${secret ?? "<secret>"}`;
  }

  /**
   * The JSON every command that mints a secret prints (#Q3132): the host's
   * identity, where it connects, the secret once, and the connector line
   * verbatim, so a script reads `.secret` or runs `.command` with no scraping.
   */
  protected minted(
    host: { id: string; slug: string; secret?: string },
    deployAllowed: boolean,
  ) {
    return {
      id: host.id,
      slug: host.slug,
      deployAllowed,
      lore: this.client.hostname(),
      secret: host.secret,
      command: this.connectorCommand(host.secret),
    };
  }

  /**
   * A provisioned server's price and what it has cost so far (#Q3168): the
   * stored hourly price times the hours since it was provisioned, said as an
   * estimate since the provider bills by its own rules.
   */
  protected costLine(host: {
    hourlyPrice?: number;
    provisionedAt?: string;
  }): string | undefined {
    if (host.hourlyPrice === undefined || !host.provisionedAt) {
      return undefined;
    }
    const hours = Math.max(
      0,
      (this.dateTime.nowMillis() - Date.parse(host.provisionedAt)) / 3_600_000,
    );
    return `about EUR ${host.hourlyPrice.toFixed(4)} an hour, about EUR ${(host.hourlyPrice * hours).toFixed(2)} so far (estimate), until lore host delete terminates it`;
  }

  /**
   * A delete Lore refuses because something still deploys there names the
   * copies and stacks; this adds the commands that remove them (#Q3169).
   */
  protected async referencedHint<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (isHttpError(error, 409)) {
        throw new CommandError(
          { exitCode: LoreRefusals.EXIT_FAILURE },
          {
            message: `${error.message}\nRemove a copy with: lore apps instance delete --app <app> --env <env> --yes (-p <project>); a stack with: lore stack destroy -e <env> --yes, then lore stack delete --yes; or delete the whole project with: lore project delete <project> --confirm <project>`,
          },
        );
      }
      throw error;
    }
  }

  protected percent(value: number): string {
    return `${Math.round(value)}%`;
  }
}
