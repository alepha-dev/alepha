import type { MonitorController } from "@lore/ship/api";
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

type MonitorApi = ReturnType<typeof $client<MonitorController>>;
type Monitor = Awaited<ReturnType<MonitorApi["setMonitorActive"]>>;
type MonitorConfig = Pick<
  Monitor,
  | "name"
  | "kind"
  | "target"
  | "intervalSecs"
  | "timeoutSecs"
  | "confirmations"
  | "expect"
  | "notifications"
>;

/**
 * `lore monitor list | get | create | update | pause | resume | delete`: a
 * project's uptime monitors (#Q3591), one verb per `monitor_*` MCP tool.
 *
 * ```bash
 * lore monitor list -p alepha --window 7d
 * lore monitor create -p alepha --name Website --kind http --target https://example.app
 * lore monitor update 0190... --expect-status 200 --keyword ok
 * lore monitor pause 0190...
 * ```
 *
 * A monitor is addressed by its id alone, as lore monitor list prints it: the
 * id carries its project, so only `list` and `create` take `--project`.
 *
 * ⚠️ `create --kind push` prints the push token once. Nothing can show it
 * again.
 *
 * ⚠️ `delete` drops the monitor's checks and incidents, so it needs `--yes`.
 * `pause` stops the checks and keeps everything.
 *
 * ⚠️ Never re-exported from `index.ts`: the controller types come from the
 * private `lore` workspace.
 */
export class MonitorCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly monitorApi = $client<MonitorController>(
    this.client.scope(),
  );

  protected static readonly PROJECT_FLAG = {
    project: z
      .text({
        aliases: ["p"],
        description: "The project, by slug or id. Defaults to LORE_PROJECT.",
      })
      .optional(),
  };

  protected static readonly WINDOW_FLAG = {
    window: z
      .enum(["24h", "7d", "30d"])
      .describe("The window the uptime covers. Defaults to 24h.")
      .optional(),
  };

  protected static readonly ID_ARG = z.text({
    title: "id",
    description: "The monitor's id, as lore monitor list prints it.",
  });

  /**
   * The settings `create` and `update` share. All optional here: `create`
   * checks for `--name`, `--kind` and `--target` itself, and `update` lays
   * what it is given over the monitor's current settings.
   */
  protected static readonly SETTINGS_FLAGS = {
    name: z.text({ description: "Display name." }).optional(),
    kind: z
      .enum(["http", "tcp", "cert", "push"])
      .describe(
        "http requests a URL, tcp opens host:port, cert reads a certificate's expiry at host:port, push waits for a job to call Lore.",
      )
      .optional(),
    target: z
      .text({
        description:
          "An http(s) URL for http, host:port for tcp and cert, nothing for push.",
      })
      .optional(),
    "interval-secs": z
      .integer()
      .describe(
        "Seconds between checks, a multiple of 60. For push, the longest gap between two pushes.",
      )
      .optional(),
    "timeout-secs": z
      .integer()
      .describe("Seconds before a check gives up, 1 to 30.")
      .optional(),
    confirmations: z
      .integer()
      .describe("Failed checks in a row before the monitor goes down.")
      .optional(),
    "expect-status": z
      .integer()
      .describe("The HTTP status a passing check answers.")
      .optional(),
    keyword: z
      .text({ description: "Text a passing check's body contains." })
      .optional(),
    "latency-budget": z
      .integer()
      .describe("Milliseconds over which a check counts as failed.")
      .optional(),
    "cert-warning-days": z
      .integer()
      .describe("Days before a certificate's expiry that count as failing.")
      .optional(),
    email: z
      .boolean()
      .describe(
        "Mail the project's members on an outage. On by default; --no-email turns it off.",
      )
      .optional(),
    recipient: z
      .array(z.email())
      .describe(
        "An extra address to mail on an outage. Repeat for several; on update, replaces the list.",
      )
      .optional(),
  };

  public readonly list = $command({
    name: "list",
    description:
      "Every uptime monitor of the project, down first, with its status and uptime over --window",
    flags: z.object({
      ...MonitorCommand.PROJECT_FLAG,
      ...MonitorCommand.WINDOW_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);

        const listed = await this.monitorApi.listMonitors({
          params: { projectId },
          query: { window: flags.window ?? "24h" },
        });

        if (flags.output === "json") {
          this.render.json(print, listed);
          return;
        }

        this.render.list(
          print,
          listed.items.map((monitor) => ({
            handle: monitor.id,
            title: `${monitor.name} (${monitor.kind}${monitor.target ? ` ${monitor.target}` : ""})`,
            fields: [monitor.status, this.percent(monitor.uptimePct)],
          })),
          undefined,
          "This project has no monitors.",
        );
      });
    },
  });

  public readonly get = $command({
    name: "get",
    description:
      "One monitor: its settings, its uptime over 24h, 7d and 30d, its incidents and its last ten checks",
    args: MonitorCommand.ID_ARG,
    flags: z.object({ ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const detail = await this.monitorApi.getMonitorDetail({
          params: { monitorId: args },
          query: { window: "24h" },
        });

        if (flags.output === "json") {
          this.render.json(print, detail);
          return;
        }

        const { monitor } = detail;
        this.render.entity(print, {
          fields: [
            ["Id", monitor.id],
            ["Name", monitor.name],
            ["Kind", monitor.kind],
            ["Target", monitor.target || undefined],
            ["Status", `${monitor.status} since ${monitor.statusSince}`],
            ["Every", `${monitor.intervalSecs}s`],
            ["Timeout", `${monitor.timeoutSecs}s`],
            ["Down after", `${monitor.confirmations} failed checks`],
            ["Last check", monitor.lastCheckedAt],
            ["Last error", monitor.lastError],
            ["Certificate expires", monitor.certExpiresAt],
          ],
          sections: [
            {
              title: "Uptime",
              lines: detail.uptime.map(
                (card) => `${card.window}  ${this.percent(card.uptimePct)}`,
              ),
            },
            {
              title: "Incidents",
              lines: detail.incidents.length
                ? detail.incidents.map(
                    (incident) =>
                      `${incident.startedAt}  ${incident.endedAt ? `${Math.round(incident.durationSecs)}s` : "open"}  ${incident.cause}${incident.lastError ? `: ${incident.lastError}` : ""}`,
                  )
                : ["None."],
            },
            {
              title: "Last checks",
              lines: detail.beats.length
                ? detail.beats
                    .slice(-10)
                    .map(
                      (beat) =>
                        `${beat.at}  ${beat.ok ? "ok" : "failed"}  ${beat.latencyMs}ms${beat.error ? `  ${beat.error}` : ""}`,
                    )
                : ["None yet."],
            },
          ],
        });
      });
    },
  });

  public readonly create = $command({
    name: "create",
    description:
      "Add a monitor. A push monitor's token is printed once, and nothing can show it again",
    flags: z.object({
      ...MonitorCommand.PROJECT_FLAG,
      ...MonitorCommand.SETTINGS_FLAGS,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const kind = flags.kind;
        if (!flags.name || !kind) {
          throw new UsageError(
            "A monitor needs --name and --kind (http, tcp, cert or push).",
          );
        }
        if (kind !== "push" && !flags.target) {
          throw new UsageError(
            `A ${kind} monitor needs --target: ${kind === "http" ? "an http(s) URL" : "host:port"}.`,
          );
        }

        const { projectId } = await this.projects.named(flags.project, context);

        const created = await this.monitorApi.createMonitor({
          params: { projectId },
          body: this.config(flags, {
            name: flags.name,
            kind,
            target: flags.target ?? "",
          }),
        });

        this.render.written(
          print,
          flags.output,
          created,
          created.token
            ? `Created ${created.monitor.name} (${created.monitor.id}). Its push token, shown once: ${created.token}`
            : `Created ${created.monitor.name} (${created.monitor.id})`,
        );
      });
    },
  });

  public readonly update = $command({
    name: "update",
    description:
      "Change a monitor's settings. Only the flags passed change; --recipient replaces the list",
    args: MonitorCommand.ID_ARG,
    flags: z.object({
      ...MonitorCommand.SETTINGS_FLAGS,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { monitor } = await this.monitorApi.getMonitorDetail({
          params: { monitorId: args },
          query: { window: "24h" },
        });

        const updated = await this.monitorApi.updateMonitor({
          params: { monitorId: args },
          body: this.config(flags, monitor),
        });

        this.render.written(
          print,
          flags.output,
          updated,
          `Updated ${updated.name} (${updated.id})`,
        );
      });
    },
  });

  public readonly pause = $command({
    name: "pause",
    description:
      "Stop a monitor's checks, keeping its history. An open outage stays open",
    args: MonitorCommand.ID_ARG,
    flags: z.object({ ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const paused = await this.monitorApi.setMonitorActive({
          params: { monitorId: args },
          body: { active: false },
        });
        this.render.written(
          print,
          flags.output,
          paused,
          `Paused ${paused.name} (${paused.id})`,
        );
      });
    },
  });

  public readonly resume = $command({
    name: "resume",
    description: "Start a paused monitor's checks again",
    args: MonitorCommand.ID_ARG,
    flags: z.object({ ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const resumed = await this.monitorApi.setMonitorActive({
          params: { monitorId: args },
          body: { active: true },
        });
        this.render.written(
          print,
          flags.output,
          resumed,
          `Resumed ${resumed.name} (${resumed.id}), now ${resumed.status}`,
        );
      });
    },
  });

  public readonly delete = $command({
    name: "delete",
    description:
      "Remove a monitor with its checks and incidents. lore monitor pause keeps them",
    args: MonitorCommand.ID_ARG,
    flags: z.object({
      yes: z
        .boolean()
        .describe(
          "Required: the monitor's checks and incidents go with it, and this cannot be undone.",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        if (!flags.yes) {
          throw new UsageError(
            "Nothing deleted: this monitor's checks and incidents would go for good, and lore monitor pause stops it without that. Pass --yes to delete it.",
          );
        }

        const result = await this.monitorApi.deleteMonitor({
          params: { monitorId: args },
        });

        this.render.written(
          print,
          flags.output,
          result,
          `Deleted monitor ${args}`,
        );
      });
    },
  });

  /**
   * ⚠️ Declared after its children. `CliProvider.findCommand` resolves by
   * `findLast`, so a second class declaring `monitor` would shadow this one
   * silently.
   */
  public readonly monitor = $command({
    name: "monitor",
    description:
      "A project's uptime monitors: list, get, create, update, pause, resume and delete them",
    children: [
      this.list,
      this.get,
      this.create,
      this.update,
      this.pause,
      this.resume,
      this.delete,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * The settings flags laid over a base: the monitor being updated, or the
   * name, kind and target `create` checked. `expect` merges key by key, so
   * `--keyword` alone keeps the expected status.
   */
  protected config(
    flags: {
      name?: string;
      kind?: Monitor["kind"];
      target?: string;
      "interval-secs"?: number;
      "timeout-secs"?: number;
      confirmations?: number;
      "expect-status"?: number;
      keyword?: string;
      "latency-budget"?: number;
      "cert-warning-days"?: number;
      email?: boolean;
      recipient?: string[];
    },
    base: Pick<Monitor, "name" | "kind" | "target"> & Partial<Monitor>,
  ): MonitorConfig {
    const expect = { ...base.expect };
    if (flags["expect-status"] !== undefined)
      expect.status = flags["expect-status"];
    if (flags.keyword !== undefined) expect.keyword = flags.keyword;
    if (flags["latency-budget"] !== undefined)
      expect.latencyBudgetMs = flags["latency-budget"];
    if (flags["cert-warning-days"] !== undefined)
      expect.certWarningDays = flags["cert-warning-days"];

    return {
      name: flags.name ?? base.name,
      kind: flags.kind ?? base.kind,
      target: flags.target ?? base.target,
      intervalSecs: flags["interval-secs"] ?? base.intervalSecs,
      timeoutSecs: flags["timeout-secs"] ?? base.timeoutSecs,
      confirmations: flags.confirmations ?? base.confirmations,
      expect,
      notifications: {
        email: flags.email ?? base.notifications?.email ?? true,
        recipients: flags.recipient ?? base.notifications?.recipients ?? [],
      },
    } as MonitorConfig;
  }

  protected percent(value: number | null): string {
    return value === null ? "no checks yet" : `${value.toFixed(2)}%`;
  }
}
