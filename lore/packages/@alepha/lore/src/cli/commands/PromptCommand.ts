import type { HostJobController } from "@lore/core/api";
import type { PromptController } from "@lore/prompts/api";
import { $inject, z } from "alepha";
import { $command, CommandError, UsageError } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

type Print = (line: string) => void;

/**
 * `lore prompt` (#E174, #Q4282): a project's prompts from a shell, with the
 * reach of Settings > Prompts: list, read, create, change, copy (`render`),
 * run, trigger and pin them. The twin of the `prompt_*` tools, which do no
 * more. A run's source is the prompt's own (`update --source`), never given
 * to a run.
 */
export class PromptCommand {
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
  protected readonly api = $client<PromptController>(this.client.scope());
  protected readonly jobs = $client<HostJobController>(this.client.scope());

  protected static readonly NAME = z.text().meta({ title: "name" });

  protected static readonly PROJECT = {
    project: z
      .text({
        aliases: ["p"],
        description: "The project, by slug or id. Defaults to LORE_PROJECT.",
      })
      .optional(),
  };

  /**
   * One value per arg, by the arg's type, or by its name with `--set`.
   */
  protected static readonly ARG_FLAGS = {
    epic: z.text({ description: "The epic arg: #E3, E3 or 3." }).optional(),
    quest: z
      .text({ description: "The quest arg: #Q12, Q12 or 12." })
      .optional(),
    feedback: z
      .text({ description: "The feedback arg: #P40, P40 or 40." })
      .optional(),
    pr: z
      .text({ description: "The pull request arg, by its number." })
      .optional(),
    member: z
      .text({
        description: "The member arg, by id; absent, you.",
      })
      .optional(),
    usecase: z
      .text({ description: "The use case arg: #U3, U3 or 3." })
      .optional(),
    persona: z
      .text({ description: "The persona arg: #A1, A1 or 1." })
      .optional(),
    requirement: z
      .text({ description: "The requirement arg: #S5, S5 or 5." })
      .optional(),
    folio: z
      .text({ description: "The folio arg: #F12, F12 or 12." })
      .optional(),
    set: z
      .array(z.text())
      .describe("A value by the arg's name, arg=reference; repeat it.")
      .optional(),
  };

  protected static readonly FIELD_FLAGS = {
    text: z
      .text({
        size: "rich",
        atFile: true,
        description:
          "The words, with {{arg.field}}, {{project}}, {{slug}} and {{projectUrl}} placeholders. @file reads a file, @- reads stdin.",
      })
      .optional(),
    title: z.text({ description: "Its title." }).optional(),
    description: z.text({ description: "What it is for." }).optional(),
    arg: z
      .array(z.text())
      .describe(
        "An arg, name:type or name:type:status|status (the statuses it accepts); repeat it. Types: epic, quest, feedback, pullRequest, member, useCase, persona, requirement, folio.",
      )
      .optional(),
    source: z
      .enum(["none", "read", "write"])
      .describe(
        "The code its runs find: none, read (the repository, read-only) or write (a worktree on a branch).",
      )
      .optional(),
    ref: z
      .text({ description: "The branch, tag or commit its code is at." })
      .optional(),
    timeoutSeconds: z
      .integer()
      .min(0)
      .describe(
        "A run's time in seconds, at least 60 and at most every agent job's ceiling; 0 returns to the default (the built-in's, or 30 minutes).",
      )
      .optional(),
  };

  protected static readonly TRIGGER_FLAGS = {
    on: z
      .text({
        description:
          "When it runs: manual, event:<key>[,<key>] (lore event catalog), hourly, 6h, daily@<h>, weekly@<day>@<h>, or both joined by a comma. Hours are UTC.",
      })
      .optional(),
    check: z
      .array(z.text())
      .describe(
        "Run only when one of these has something to do: feedback, errors, quests, epics; comma-separated or repeated.",
      )
      .optional(),
    maxPerHour: z
      .integer()
      .min(1)
      .max(60)
      .describe("Its runs per hour at most.")
      .optional(),
    maxPerDay: z
      .integer()
      .min(1)
      .max(1000)
      .describe("Its runs per day at most.")
      .optional(),
  };

  protected async projectId(
    project: string | undefined,
    context: LoreRefusalContext,
  ) {
    return this.projects.named(project, context);
  }

  /**
   * `name:type` or `name:type:status|status`.
   */
  protected argsOf(values: string[]) {
    return values.map((value) => {
      const [name, type, accepts] = value.split(":");
      if (!name || !type) {
        throw new UsageError(
          `--arg ${value}: write name:type or name:type:status|status`,
        );
      }
      return {
        name,
        type: type as "epic",
        ...(accepts ? { accepts: accepts.split("|").filter(Boolean) } : {}),
      };
    });
  }

  /**
   * `arg=reference`, each.
   */
  protected setOf(values: string[] | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const value of values ?? []) {
      const at = value.indexOf("=");
      if (at < 1) throw new UsageError(`--set ${value}: write arg=reference`);
      out[value.slice(0, at)] = value.slice(at + 1);
    }
    return out;
  }

  /**
   * The values of a render or a run: each typed flag fills the prompt's arg
   * of that type, `--set` an arg by its name.
   */
  protected async valuesOf(
    projectId: number,
    name: string,
    flags: {
      epic?: string;
      quest?: string;
      feedback?: string;
      pr?: string;
      member?: string;
      usecase?: string;
      persona?: string;
      requirement?: string;
      folio?: string;
      set?: string[];
    },
  ): Promise<Record<string, string>> {
    const typed: Array<[string, string | undefined]> = [
      ["epic", flags.epic],
      ["quest", flags.quest],
      ["feedback", flags.feedback],
      ["pullRequest", flags.pr],
      ["member", flags.member],
      ["useCase", flags.usecase],
      ["persona", flags.persona],
      ["requirement", flags.requirement],
      ["folio", flags.folio],
    ];
    const values = this.setOf(flags.set);
    if (typed.some(([, value]) => value)) {
      const prompt = await this.api.getPrompt({ params: { projectId, name } });
      for (const [type, value] of typed) {
        if (!value) continue;
        const arg = prompt.args.find((it) => it.type === type);
        if (!arg) {
          throw new UsageError(`${name} takes no ${type} arg`);
        }
        values[arg.name] = value;
      }
    }
    return values;
  }

  protected checksOf(values: string[] | undefined) {
    return values
      ?.flatMap((it) => it.split(","))
      .map((it) => it.trim())
      .filter(Boolean) as Array<"feedback" | "errors" | "quests" | "epics">;
  }

  public readonly list = $command({
    name: "list",
    description:
      "The project's prompts: the built-ins it can use, then its own, with their args, source, trigger, pins and last run",
    flags: z.object({ ...PromptCommand.PROJECT, ...LoreOutput.FLAGS }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projectId(flags.project, context);
        const answer = await this.api.listPrompts({ params: { projectId } });
        if (flags.output === "json") {
          this.render.json(print, answer);
          return;
        }
        this.render.list(
          print,
          answer.items.map((it) => ({
            handle: it.name,
            title: `${it.title}${it.builtin ? " (built-in)" : ""}`,
            fields: [
              [
                it.args.map((arg) => `${arg.name}:${arg.type}`).join(" "),
                `source ${it.source}`,
                it.on === "manual" ? "" : `on ${it.on}`,
                it.pins.length ? `pinned ${it.pins.join(",")}` : "",
              ]
                .filter(Boolean)
                .join("  "),
              it.lastSkippedReason &&
              (it.lastSkippedAt ?? "") > (it.lastRunAt ?? "")
                ? `skipped: ${it.lastSkippedReason}`
                : it.lastRunAt
                  ? `last run ${it.lastRunAt}`
                  : "",
            ],
          })),
          undefined,
          "This project has no prompt.",
        );
        if (answer.pausedAt) print(`Triggers paused since ${answer.pausedAt}`);
      });
    },
  });

  public readonly get = $command({
    name: "get",
    description: "One prompt, its words included",
    args: PromptCommand.NAME,
    flags: z.object({ ...PromptCommand.PROJECT, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projectId(flags.project, context);
        const it = await this.api.getPrompt({
          params: { projectId, name: args },
        });
        if (flags.output === "json") {
          this.render.json(print, it);
          return;
        }
        this.render.entity(print, {
          fields: [
            ["Name", it.name],
            ["Title", it.title],
            ["Kind", it.builtin ? "built-in" : "custom"],
            [
              "Args",
              it.args
                .map(
                  (arg) =>
                    `${arg.name}:${arg.type}${arg.accepts?.length ? `:${arg.accepts.join("|")}` : ""}`,
                )
                .join(" "),
            ],
            ["Source", `${it.source}${it.ref ? ` @ ${it.ref}` : ""}`],
            ["Trigger", it.on],
            ["Pinned", it.pins.join(", ")],
            ["Enabled", it.enabled ? "yes" : "no"],
          ],
          body: it.text,
        });
      });
    },
  });

  public readonly create = $command({
    name: "create",
    description:
      "Create a custom prompt: a name, its words, its args and its source",
    args: PromptCommand.NAME,
    flags: z.object({
      ...PromptCommand.PROJECT,
      ...PromptCommand.FIELD_FLAGS,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        if (!flags.text) throw new UsageError("--text is required");
        const { projectId } = await this.projectId(flags.project, context);
        const it = await this.api.createPrompt({
          params: { projectId },
          body: {
            name: args,
            text: flags.text,
            ...(flags.title ? { title: flags.title } : {}),
            ...(flags.description ? { description: flags.description } : {}),
            ...(flags.arg ? { args: this.argsOf(flags.arg) } : {}),
            ...(flags.source ? { source: flags.source } : {}),
            ...(flags.ref ? { ref: flags.ref } : {}),
            ...(flags.timeoutSeconds
              ? { timeoutSeconds: flags.timeoutSeconds }
              : {}),
          },
        });
        this.render.written(print, flags.output, it, `Created ${it.name}`);
      });
    },
  });

  /**
   * Every field of a prompt in one call, as `prompt_update` takes them.
   */
  public readonly update = $command({
    name: "update",
    description:
      "Change a prompt: a custom one's words, title, description and args; any prompt's source, ref, host, agent, model, trigger, pins and switch",
    args: PromptCommand.NAME,
    flags: z.object({
      ...PromptCommand.PROJECT,
      ...PromptCommand.FIELD_FLAGS,
      host: z
        .text({ description: "The Agent host its runs use; empty clears it." })
        .optional(),
      agent: z
        .text({ description: "The agent CLI its runs use; empty clears it." })
        .optional(),
      model: z
        .text({ description: "The model its runs use; empty clears it." })
        .optional(),
      enabled: z
        .boolean()
        .describe("Its trigger on or off; a run by hand always works.")
        .optional(),
      ...PromptCommand.TRIGGER_FLAGS,
      set: PromptCommand.ARG_FLAGS.set.describe(
        "A value stored for an arg its trigger does not fill, arg=reference; repeat it.",
      ),
      pin: z
        .array(z.text())
        .describe(
          "The pages it is pinned to, replacing the list: quests, quest, epics, epic, feedback, feedback-item, errors; repeat it.",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projectId(flags.project, context);
        const it = await this.api.updatePrompt({
          params: { projectId, name: args },
          body: {
            ...(flags.text ? { text: flags.text } : {}),
            ...(flags.title ? { title: flags.title } : {}),
            ...(flags.description === undefined
              ? {}
              : { description: flags.description }),
            ...(flags.arg ? { args: this.argsOf(flags.arg) } : {}),
            ...(flags.source ? { source: flags.source } : {}),
            ...(flags.ref === undefined ? {} : { ref: flags.ref || null }),
            ...(flags.host === undefined ? {} : { host: flags.host || null }),
            ...(flags.agent === undefined
              ? {}
              : { agent: flags.agent || null }),
            ...(flags.model === undefined
              ? {}
              : { model: flags.model || null }),
            ...(flags.enabled === undefined ? {} : { enabled: flags.enabled }),
            ...(flags.on ? { on: flags.on } : {}),
            ...(flags.check ? { check: this.checksOf(flags.check) } : {}),
            ...(flags.set ? { argValues: this.setOf(flags.set) } : {}),
            ...(flags.maxPerHour ? { maxRunsPerHour: flags.maxPerHour } : {}),
            ...(flags.maxPerDay ? { maxRunsPerDay: flags.maxPerDay } : {}),
            ...(flags.pin ? { pins: flags.pin } : {}),
            ...(flags.timeoutSeconds === undefined
              ? {}
              : { timeoutSeconds: flags.timeoutSeconds || null }),
          },
        });
        this.render.written(print, flags.output, it, `Updated ${it.name}`);
      });
    },
  });

  public readonly duplicate = $command({
    name: "duplicate",
    description:
      "Copy any prompt, a built-in included, into a custom one under a new name",
    args: PromptCommand.NAME,
    flags: z.object({
      ...PromptCommand.PROJECT,
      newName: z.text({ description: "The copy's name." }),
      title: z.text({ description: "The copy's title." }).optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projectId(flags.project, context);
        const it = await this.api.duplicatePrompt({
          params: { projectId, name: args },
          body: {
            name: flags.newName,
            ...(flags.title ? { title: flags.title } : {}),
          },
        });
        this.render.written(
          print,
          flags.output,
          it,
          `Duplicated ${args} as ${it.name}`,
        );
      });
    },
  });

  public readonly delete = $command({
    name: "delete",
    description: "Delete a custom prompt; its past jobs stay",
    args: PromptCommand.NAME,
    flags: z.object({ ...PromptCommand.PROJECT, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projectId(flags.project, context);
        const ok = await this.api.deletePrompt({
          params: { projectId, name: args },
        });
        this.render.written(print, flags.output, ok, `Deleted ${args}`);
      });
    },
  });

  /**
   * The CLI's Copy.
   */
  public readonly renderText = $command({
    name: "render",
    description:
      "Print a prompt's words with its args filled, each item read with your permissions",
    args: PromptCommand.NAME,
    flags: z.object({
      ...PromptCommand.PROJECT,
      ...PromptCommand.ARG_FLAGS,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projectId(flags.project, context);
        const out = await this.api.renderPrompt({
          params: { projectId, name: args },
          body: { args: await this.valuesOf(projectId, args, flags) },
        });
        this.render.written(print, flags.output, out, out.text);
      });
    },
  });

  public readonly run = $command({
    name: "run",
    description:
      "Run a prompt on the project's Agent host, its args filled; prints the job and its page. --wait follows its log",
    args: PromptCommand.NAME,
    flags: z.object({
      ...PromptCommand.PROJECT,
      ...PromptCommand.ARG_FLAGS,
      host: z
        .text({
          description: "The Agent host, by slug; needed with several",
        })
        .optional(),
      agent: z
        .text({
          description: "The agent CLI; absent, the first the host reports",
        })
        .optional(),
      model: z
        .text({ description: "The model; absent, the CLI's default" })
        .optional(),
      fix: z
        .boolean()
        .describe("review-pr: push its fixes to the pull request's branch")
        .optional(),
      trust: z
        .boolean()
        .describe("review-pr: you trust the pull request's author")
        .optional(),
      continue: z
        .text({
          description:
            "A job of this prompt that failed, timed out or was cancelled: continue it in its workspace and on its branch, resuming its agent session",
        })
        .optional(),
      wait: z
        .boolean()
        .describe(
          "Follow the job's log until it ends, and exit with its status",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { project, projectId } = await this.projectId(
          flags.project,
          context,
        );
        const values = await this.valuesOf(projectId, args, flags);
        const started = await this.api.runPrompt({
          params: { projectId, name: args },
          body: {
            // A continued job's args stand when none are given (#Q4340).
            ...(flags.continue && !Object.keys(values).length
              ? {}
              : { args: values }),
            ...(flags.continue ? { continue: flags.continue } : {}),
            ...(flags.host ? { host: flags.host } : {}),
            ...(flags.agent ? { agent: flags.agent } : {}),
            ...(flags.model ? { model: flags.model } : {}),
            ...(flags.fix ? { fix: true } : {}),
            ...(flags.trust ? { trust: true } : {}),
          },
        });
        const skipped = started.skipped.length
          ? `; left out for want of a member's trust: ${started.skipped.map((n) => `P${n}`).join(", ")}`
          : "";
        const url = `${this.client.hostname()}/${project}/jobs/${started.jobId}`;
        if (!flags.wait) {
          this.render.written(
            print,
            flags.output,
            { ...started, url },
            `Started job ${started.jobId}${skipped}: ${url}. Follow it with lore job logs ${started.jobId} --follow`,
          );
          return;
        }
        print(`Started job ${started.jobId}${skipped}`);
        await this.follow(started.jobId, print);
      });
    },
  });

  protected async follow(jobId: string, print: Print): Promise<void> {
    let after = { stdout: 0, stderr: 0 };
    for (;;) {
      const log = await this.jobs.getJobLog({
        params: { jobId },
        query: after,
      });
      for (const text of [log.stdout, log.stderr]) {
        if (text) print(text.replace(/\n$/, ""));
      }
      after = log.next;
      if (!log.live) break;
      await this.dateTime.wait(this.pollMillis);
    }
    const job = await this.jobs.getJob({ params: { jobId } });
    if (job.status !== "succeeded") {
      throw new CommandError(
        { exitCode: LoreRefusals.EXIT_FAILURE },
        {
          message: `Job ${job.id} ended ${job.status}${job.reason ? `: ${job.reason}` : ""}`,
        },
      );
    }
    print(`Job ${job.id} succeeded`);
  }

  public readonly trigger = $command({
    name: "trigger",
    description:
      "Set a prompt's trigger: when it runs, what it checks first, a value per arg the trigger does not fill, its ceilings",
    args: PromptCommand.NAME,
    flags: z.object({
      ...PromptCommand.PROJECT,
      ...PromptCommand.TRIGGER_FLAGS,
      set: PromptCommand.ARG_FLAGS.set,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projectId(flags.project, context);
        const it = await this.api.updatePrompt({
          params: { projectId, name: args },
          body: {
            ...(flags.on ? { on: flags.on } : {}),
            ...(flags.check ? { check: this.checksOf(flags.check) } : {}),
            ...(flags.set ? { argValues: this.setOf(flags.set) } : {}),
            ...(flags.maxPerHour ? { maxRunsPerHour: flags.maxPerHour } : {}),
            ...(flags.maxPerDay ? { maxRunsPerDay: flags.maxPerDay } : {}),
          },
        });
        this.render.written(
          print,
          flags.output,
          it,
          `${it.name} runs ${it.on}${it.nextRunAt ? `, next at ${it.nextRunAt}` : ""}`,
        );
      });
    },
  });

  protected pagesOf(values: string[] | undefined): string[] {
    return (values ?? [])
      .flatMap((it) => it.split(","))
      .map((it) => it.trim())
      .filter(Boolean);
  }

  public readonly pin = $command({
    name: "pin",
    description:
      "Pin a prompt to pages: quests, quest, epics, epic, feedback, feedback-item, errors",
    args: PromptCommand.NAME,
    flags: z.object({
      ...PromptCommand.PROJECT,
      on: z.array(z.text()).describe("The pages, comma-separated or repeated."),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projectId(flags.project, context);
        const now = await this.api.getPrompt({
          params: { projectId, name: args },
        });
        const it = await this.api.updatePrompt({
          params: { projectId, name: args },
          body: { pins: [...now.pins, ...this.pagesOf(flags.on)] },
        });
        this.render.written(
          print,
          flags.output,
          it,
          `${it.name} is pinned on ${it.pins.join(", ") || "no page"}`,
        );
      });
    },
  });

  public readonly unpin = $command({
    name: "unpin",
    description: "Unpin a prompt from some pages, or from every page",
    args: PromptCommand.NAME,
    flags: z.object({
      ...PromptCommand.PROJECT,
      on: z
        .array(z.text())
        .describe("The pages; absent, every page.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projectId(flags.project, context);
        const now = await this.api.getPrompt({
          params: { projectId, name: args },
        });
        const off = new Set(this.pagesOf(flags.on));
        const it = await this.api.updatePrompt({
          params: { projectId, name: args },
          body: {
            pins: flags.on ? now.pins.filter((page) => !off.has(page)) : [],
          },
        });
        this.render.written(
          print,
          flags.output,
          it,
          `${it.name} is pinned on ${it.pins.join(", ") || "no page"}`,
        );
      });
    },
  });

  protected switchCommand(name: "enable" | "disable") {
    return $command({
      name,
      description:
        name === "enable"
          ? "Turn a prompt's trigger on"
          : "Turn a prompt's trigger off; a run by hand still works",
      args: PromptCommand.NAME,
      flags: z.object({ ...PromptCommand.PROJECT, ...LoreOutput.FLAGS }),
      handler: async ({ args, flags, print }) => {
        const context: LoreRefusalContext = {};
        await this.refusals.guard(context, async () => {
          const { projectId } = await this.projectId(flags.project, context);
          const it = await this.api.updatePrompt({
            params: { projectId, name: args },
            body: { enabled: name === "enable" },
          });
          this.render.written(
            print,
            flags.output,
            it,
            `${it.name} is ${it.enabled ? "enabled" : "disabled"}`,
          );
        });
      },
    });
  }

  public readonly enable = this.switchCommand("enable");
  public readonly disable = this.switchCommand("disable");

  protected pauseCommand(paused: boolean) {
    return $command({
      name: paused ? "pause-all" : "resume-all",
      description: paused
        ? "Pause every prompt's trigger in the project; a run by hand still works"
        : "Resume the project's prompt triggers",
      flags: z.object({ ...PromptCommand.PROJECT, ...LoreOutput.FLAGS }),
      handler: async ({ flags, print }) => {
        const context: LoreRefusalContext = {};
        await this.refusals.guard(context, async () => {
          const { projectId } = await this.projectId(flags.project, context);
          const out = await this.api.setPromptsPaused({
            params: { projectId },
            body: { paused },
          });
          this.render.written(
            print,
            flags.output,
            out,
            paused ? "Triggers paused" : "Triggers resumed",
          );
        });
      },
    });
  }

  public readonly pauseAll = this.pauseCommand(true);
  public readonly resumeAll = this.pauseCommand(false);

  /**
   * ⚠️ Declared after its children.
   */
  public readonly prompt = $command({
    name: "prompt",
    description:
      "A project's prompts: list, read, create, change, copy (render), run, trigger and pin them",
    children: [
      this.list,
      this.get,
      this.create,
      this.update,
      this.duplicate,
      this.delete,
      this.renderText,
      this.run,
      this.trigger,
      this.pin,
      this.unpin,
      this.enable,
      this.disable,
      this.pauseAll,
      this.resumeAll,
    ],
    handler: async ({ help }) => {
      help();
    },
  });
}
