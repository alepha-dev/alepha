import type {
  AgentAutomationController,
  HostJobController,
} from "@lore/core/api";
import { $inject, z } from "alepha";
import { $command, CommandError } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore automation` (#Q4231): a project's agent automations, a prompt run on
 * one of its Agent hosts by hand, on project events or on a schedule. The
 * first surface of the feature: the owner sets them up from a coding agent.
 * The twins of the `automation_*` tools; MCP is never wider.
 *
 * ```bash
 * lore automation create triage --prompt triage --on event:feedback.created,feedback.trusted
 * lore automation create build --prompt build --on event:quest.created --auto-merge
 * lore automation create rounds --prompt chat --agent bruce --room ops --text 'Do your rounds' --on daily@7
 * lore automation create nightly --text "Summarise the week" --on daily@7
 * ```
 */
export class AutomationCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * How often `run --wait` asks for more of the log. A field so a spec can
   * shorten it.
   */
  protected pollMillis = 2_000;

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly api = $client<AgentAutomationController>(
    this.client.scope(),
  );
  protected readonly jobs = $client<HostJobController>(this.client.scope());

  protected static readonly PROJECT = z
    .text({
      aliases: ["p"],
      description: "The project, by slug or id. Defaults to LORE_PROJECT.",
    })
    .optional();

  protected static readonly NAME = z
    .text({ description: "The automation's name" })
    .meta({ title: "name" });

  /**
   * The flags create and update share.
   */
  protected static readonly WRITE = {
    text: z
      .text({
        description:
          "A text automation's words, run under Lore's preamble (implies --prompt text)",
      })
      .optional(),
    host: z
      .text({
        description:
          "The Agent host, by slug; needed when the project has several",
      })
      .optional(),
    agent: z
      .text({
        description:
          "The agent CLI (claude, gemini); needed when the host has several. For --prompt chat, the chat agent's handle",
      })
      .optional(),
    room: z
      .text({
        description:
          "A chat automation's room, by name: its agent answers there",
      })
      .optional(),
    model: z
      .text({
        description: "The model passed to the agent; absent, its default",
      })
      .optional(),
    on: z
      .text({
        description:
          "When it runs: manual, event:<key>[,<key>] (see lore event catalog), hourly, 6h or daily@<utc-hour>",
      })
      .optional(),
    onlyIfWork: z
      .boolean()
      .describe(
        "Run only when Lore finds something to do first, so an idle project spends no tokens",
      )
      .optional(),
    autoMerge: z
      .boolean()
      .describe("A build's pull requests ask for auto-merge")
      .optional(),
    concurrency: z
      .integer()
      .min(1)
      .max(16)
      .describe(
        "Build jobs at once, one quest each (default 1); past the host's own limit they wait in its queue",
      )
      .optional(),
    settleSeconds: z
      .integer()
      .min(0)
      .max(3600)
      .describe(
        "How long an event run waits after the first event of a burst (default 60)",
      )
      .optional(),
    maxRunsPerHour: z
      .integer()
      .min(1)
      .max(60)
      .describe("The most runs its trigger starts in an hour (default 6)")
      .optional(),
    maxRunsPerDay: z
      .integer()
      .min(1)
      .max(1000)
      .describe("The most runs its trigger starts in a day (default 48)")
      .optional(),
  };

  public readonly list = $command({
    name: "list",
    description:
      "The project's agent automations: prompt, trigger, where they run, last run and why they last skipped",
    flags: z.object({
      project: AutomationCommand.PROJECT,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      await this.guarded(flags.project, async (projectId) => {
        const { items } = await this.api.listProjectAutomations({
          params: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, { automations: items });
          return;
        }
        this.render.list(
          print,
          items.map((it) => ({
            handle: it.name,
            title: `${it.promptKind} on ${this.onOf(it)}${it.enabled ? "" : " (disabled)"}`,
            fields: [
              it.promptKind === "chat"
                ? `@${it.agent} in #${it.room}`
                : [it.host, it.agent, it.model].filter(Boolean).join(" / ") ||
                  "the project's Agent host",
              ...(it.lastRunAt ? [`last run ${it.lastRunAt}`] : []),
              ...(it.lastJobId ? [`job ${it.lastJobId}`] : []),
              ...(it.nextRunAt ? [`next run ${it.nextRunAt}`] : []),
              ...(it.lastSkippedReason
                ? [`skipped: ${it.lastSkippedReason}`]
                : []),
            ],
          })),
          undefined,
          "This project has no agent automation.",
        );
      });
    },
  });

  public readonly create = $command({
    name: "create",
    description:
      "Create an agent automation: --prompt triage|build|chat, or --text '...', and --on for when it runs",
    args: AutomationCommand.NAME,
    flags: z.object({
      project: AutomationCommand.PROJECT,
      prompt: z
        .enum(["triage", "build", "text", "chat"])
        .describe(
          "triage (the inbox and the open errors), build (every quest not tagged needs-human into a pull request), text, or chat (a chat agent's rounds in a room: --agent, --room and --text)",
        )
        .optional(),
      ...AutomationCommand.WRITE,
      enabled: z
        .boolean()
        .describe("Whether its trigger runs it (default true)")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      await this.guarded(flags.project, async (projectId) => {
        const promptKind =
          flags.prompt ??
          (flags.room ? "chat" : flags.text ? "text" : undefined);
        if (!promptKind) {
          throw new CommandError(
            { exitCode: LoreRefusals.EXIT_FAILURE },
            { message: "Name the prompt: --prompt triage|build, or --text" },
          );
        }
        const created = await this.api.createProjectAutomation({
          params: { projectId },
          body: {
            name: args,
            promptKind,
            ...this.write(flags),
            ...(flags.enabled === undefined ? {} : { enabled: flags.enabled }),
          },
        });
        this.render.written(
          print,
          flags.output,
          created,
          `Created automation ${created.name}: ${created.promptKind} on ${this.onOf(created)}`,
        );
      });
    },
  });

  public readonly update = $command({
    name: "update",
    description:
      "Change an agent automation: only the flags given change; an empty --host, --agent or --model clears it",
    args: AutomationCommand.NAME,
    flags: z.object({
      project: AutomationCommand.PROJECT,
      newName: z.text({ description: "A new name" }).optional(),
      prompt: z
        .enum(["triage", "build", "text", "chat"])
        .describe("Another prompt: triage, build, text or chat")
        .optional(),
      ...AutomationCommand.WRITE,
      enabled: z.boolean().describe("Turn its trigger on or off").optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      await this.guarded(flags.project, async (projectId) => {
        const updated = await this.api.updateProjectAutomation({
          params: { projectId, automation: args },
          body: {
            ...(flags.newName ? { name: flags.newName } : {}),
            ...(flags.prompt ? { promptKind: flags.prompt } : {}),
            ...this.write(flags),
            ...(flags.enabled === undefined ? {} : { enabled: flags.enabled }),
          },
        });
        this.render.written(
          print,
          flags.output,
          updated,
          `Updated automation ${updated.name}: ${updated.promptKind} on ${this.onOf(updated)}${updated.enabled ? "" : " (disabled)"}`,
        );
      });
    },
  });

  public readonly enable = $command({
    name: "enable",
    description: "Turn an automation's trigger on",
    args: AutomationCommand.NAME,
    flags: z.object({ project: AutomationCommand.PROJECT }),
    handler: async ({ args, flags, print }) => {
      await this.switchTo(args, flags.project, true, print);
    },
  });

  public readonly disable = $command({
    name: "disable",
    description: "Turn an automation's trigger off; a run by hand still works",
    args: AutomationCommand.NAME,
    flags: z.object({ project: AutomationCommand.PROJECT }),
    handler: async ({ args, flags, print }) => {
      await this.switchTo(args, flags.project, false, print);
    },
  });

  public readonly delete = $command({
    name: "delete",
    description: "Delete an automation; its past jobs stay",
    args: AutomationCommand.NAME,
    flags: z.object({ project: AutomationCommand.PROJECT }),
    handler: async ({ args, flags, print }) => {
      await this.guarded(flags.project, async (projectId) => {
        await this.api.deleteProjectAutomation({
          params: { projectId, automation: args },
        });
        print(`Deleted automation ${args}`);
      });
    },
  });

  public readonly run = $command({
    name: "run",
    description:
      "Run an automation once, by hand, as you; --wait follows its first job's log",
    args: AutomationCommand.NAME,
    flags: z.object({
      project: AutomationCommand.PROJECT,
      wait: z
        .boolean()
        .describe(
          "Follow the job's log until it ends, and exit with its status",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      await this.guarded(flags.project, async (projectId, project) => {
        const out = await this.api.runProjectAutomation({
          params: { projectId, automation: args },
        });
        const first = out.jobIds[0];
        if (!first) {
          this.render.written(
            print,
            flags.output,
            out,
            `Nothing started: ${out.skipped ?? "no job"}`,
          );
          return;
        }
        const urls = out.jobIds.map(
          (id) => `${this.client.hostname()}/${project}/jobs/${id}`,
        );
        if (!flags.wait) {
          this.render.written(
            print,
            flags.output,
            { ...out, urls },
            `Started ${out.jobIds.length} job(s): ${urls.join(", ")}`,
          );
          return;
        }
        print(`Started job ${first}`);
        let after = { stdout: 0, stderr: 0 };
        for (;;) {
          const log = await this.jobs.getJobLog({
            params: { jobId: first },
            query: after,
          });
          for (const text of [log.stdout, log.stderr]) {
            if (text) print(text.replace(/\n$/, ""));
          }
          after = log.next;
          if (!log.live) break;
          await this.dateTime.wait(this.pollMillis);
        }
        const job = await this.jobs.getJob({ params: { jobId: first } });
        if (job.status !== "succeeded") {
          throw new CommandError(
            { exitCode: LoreRefusals.EXIT_FAILURE },
            {
              message: `Job ${job.id} ended ${job.status}${job.reason ? `: ${job.reason}` : ""}`,
            },
          );
        }
        print(`Job ${job.id} succeeded`);
      });
    },
  });

  public readonly pauseAll = $command({
    name: "pause-all",
    description:
      "Pause every automation of the project: no event or schedule starts a run; a run by hand still works",
    flags: z.object({ project: AutomationCommand.PROJECT }),
    handler: async ({ flags, print }) => {
      await this.guarded(flags.project, async (projectId) => {
        await this.api.setProjectAutomationSettings({
          params: { projectId },
          body: { paused: true },
        });
        print("Paused every automation of the project");
      });
    },
  });

  public readonly resumeAll = $command({
    name: "resume-all",
    description: "Resume the project's automations after pause-all",
    flags: z.object({ project: AutomationCommand.PROJECT }),
    handler: async ({ flags, print }) => {
      await this.guarded(flags.project, async (projectId) => {
        await this.api.setProjectAutomationSettings({
          params: { projectId },
          body: { paused: false },
        });
        print("Resumed the project's automations");
      });
    },
  });

  public readonly settings = $command({
    name: "settings",
    description:
      "Whether the project's automations are paused, and the daily ceiling on the builds they start; --builds-per-day sets it",
    flags: z.object({
      project: AutomationCommand.PROJECT,
      buildsPerDay: z
        .integer()
        .min(0)
        .max(1000)
        .describe("Builds the automations start per day (default 20)")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      await this.guarded(flags.project, async (projectId) => {
        const settings =
          flags.buildsPerDay === undefined
            ? await this.api.getProjectAutomationSettings({
                params: { projectId },
              })
            : await this.api.setProjectAutomationSettings({
                params: { projectId },
                body: { buildsPerDay: flags.buildsPerDay },
              });
        this.render.written(
          print,
          flags.output,
          settings,
          `${settings.pausedAt ? `Paused since ${settings.pausedAt}` : "Running"}; at most ${settings.buildsPerDay} builds a day`,
        );
      });
    },
  });

  public readonly automation = $command({
    name: "automation",
    description:
      "Agent automations: a prompt run on an Agent host by hand, on project events or on a schedule",
    children: [
      this.list,
      this.create,
      this.update,
      this.enable,
      this.disable,
      this.delete,
      this.run,
      this.pauseAll,
      this.resumeAll,
      this.settings,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  protected async guarded(
    flag: string | undefined,
    act: (projectId: number, project: string) => Promise<void>,
  ): Promise<void> {
    const context: LoreRefusalContext = {};
    await this.refusals.guard(context, async () => {
      const { project, projectId } = await this.projects.named(flag, context);
      await act(projectId, project);
    });
  }

  protected async switchTo(
    name: string,
    flag: string | undefined,
    enabled: boolean,
    print: (line: string) => void,
  ): Promise<void> {
    await this.guarded(flag, async (projectId) => {
      await this.api.updateProjectAutomation({
        params: { projectId, automation: name },
        body: { enabled },
      });
      print(`${enabled ? "Enabled" : "Disabled"} automation ${name}`);
    });
  }

  /**
   * A row's trigger in `--on`'s form.
   */
  protected onOf(row: {
    trigger: string;
    eventKeys?: string[];
    schedule?: string;
    dailyHour?: number;
  }): string {
    if (row.trigger === "event")
      return `event:${(row.eventKeys ?? []).join(",")}`;
    if (row.trigger === "schedule") {
      return row.schedule === "daily"
        ? `daily@${row.dailyHour ?? 0} UTC`
        : (row.schedule ?? "hourly");
    }
    return "manual";
  }

  protected write(flags: {
    text?: string;
    host?: string;
    agent?: string;
    model?: string;
    room?: string;
    on?: string;
    onlyIfWork?: boolean;
    autoMerge?: boolean;
    concurrency?: number;
    settleSeconds?: number;
    maxRunsPerHour?: number;
    maxRunsPerDay?: number;
  }) {
    return {
      ...(flags.text === undefined ? {} : { promptText: flags.text }),
      ...(flags.host === undefined ? {} : { host: flags.host }),
      ...(flags.agent === undefined ? {} : { agent: flags.agent }),
      ...(flags.model === undefined ? {} : { model: flags.model }),
      ...(flags.room === undefined ? {} : { room: flags.room }),
      ...(flags.on === undefined ? {} : { on: flags.on }),
      ...(flags.onlyIfWork === undefined
        ? {}
        : { onlyIfWork: flags.onlyIfWork }),
      ...(flags.autoMerge === undefined ? {} : { autoMerge: flags.autoMerge }),
      ...(flags.concurrency === undefined
        ? {}
        : { concurrency: flags.concurrency }),
      ...(flags.settleSeconds === undefined
        ? {}
        : { settleSeconds: flags.settleSeconds }),
      ...(flags.maxRunsPerHour === undefined
        ? {}
        : { maxRunsPerHour: flags.maxRunsPerHour }),
      ...(flags.maxRunsPerDay === undefined
        ? {}
        : { maxRunsPerDay: flags.maxRunsPerDay }),
    };
  }
}
