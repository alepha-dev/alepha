import type { HostJobController } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $command } from "alepha/command";
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
 * `lore job`: a project's host jobs from a shell (#Q3984), the twins of
 * `job_list`, `job_get`, `job_cancel` and `job_poke` (#Q4456), plus `logs`,
 * which follows a running job's output until it ends.
 */
export class JobCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * How often `logs --follow` asks for more. A field so a spec can shorten it.
   */
  protected pollMillis = 2_000;

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly api = $client<HostJobController>(this.client.scope());

  protected static readonly STATUSES = [
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "timed_out",
  ] as const;

  public readonly list = $command({
    name: "list",
    description: "The project's host jobs, newest first",
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description: "The project, by slug or id. Defaults to LORE_PROJECT.",
        })
        .optional(),
      status: z
        .enum(JobCommand.STATUSES)
        .describe("Only the jobs in this status.")
        .optional(),
      limit: z
        .integer()
        .min(1)
        .max(500)
        .describe("How many jobs, newest first. Defaults to 50.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const { items } = await this.api.listProjectJobs({
          params: { projectId },
          query: { limit: flags.status ? 500 : (flags.limit ?? 50) },
        });
        const jobs = (
          flags.status
            ? items.filter((item) => item.status === flags.status)
            : items
        ).slice(0, flags.limit ?? 50);
        if (flags.output === "json") {
          this.render.json(print, { jobs });
          return;
        }
        this.render.list(
          print,
          jobs.map((job) => ({
            handle: job.id,
            title: `${job.kind} ${job.status}`,
            fields: [
              job.hostSlug ? `on ${job.hostSlug}` : "",
              job.subjectType ? `${job.subjectType} ${job.subjectId}` : "",
              job.startedByName ? `by ${job.startedByName}` : "",
              job.queuedAt,
            ].filter(Boolean),
          })),
          undefined,
          "No job has run in this project.",
        );
      });
    },
  });

  public readonly get = $command({
    name: "get",
    description: "One host job: what it ran, its status and its result",
    args: z.text({ title: "id", description: "The job's id." }),
    flags: z.object({
      log: z
        .boolean()
        .describe("Also print the job's log, both streams.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const job = await this.api.getJob({ params: { jobId: args } });
        const log = flags.log
          ? await this.api.getJobLog({ params: { jobId: args }, query: {} })
          : undefined;
        if (flags.output === "json") {
          this.render.json(print, {
            ...job,
            ...(log ? { stdout: log.stdout, stderr: log.stderr } : {}),
          });
          return;
        }
        this.render.entity(print, {
          fields: [
            ["Job", job.id],
            ["Kind", job.kind],
            ["Status", job.status],
            ["Host", job.hostSlug],
            ["Agent", job.input.agent],
            // The model that ran (#Q4304): the run's, or the one its agent
            // CLI reported, as the job page names it.
            ["Model", job.input.model ?? job.model],
            ["Workspace", job.input.workspace],
            // What code it found (#E173): the source, its ref or branch, and
            // the commit the host resolved.
            ["Source", job.input.source?.mode],
            ["Ref", job.input.source?.ref],
            ["Branch", job.input.source?.branch],
            ["Commit", job.commit],
            [
              "Subject",
              job.subjectType
                ? `${job.subjectType} ${job.subjectId}`
                : undefined,
            ],
            ["Started by", job.startedByName],
            ["Queued", job.queuedAt],
            ["Started", job.startedAt],
            ["Ended", job.endedAt],
            ["Exit code", job.exitCode],
            ["Reason", job.reason],
            ["Warning", job.warning],
            // Its steps (#Q4433): the quests its key accepted, done of total,
            // or for a single quest its objectives.
            [
              "Steps",
              job.steps
                ? `${job.steps.done} of ${job.steps.total} ${job.steps.unit === "objective" ? "objectives" : "quests"}`
                : undefined,
            ],
            [
              "Current",
              job.steps?.current ? `#Q${job.steps.current}` : undefined,
            ],
            ["Last step", job.steps?.lastStepAt],
            // The run's own pace (#Q4436): the steps left as a range, which
            // leaves out the review, checks and merge after the last one.
            [
              "Pace",
              job.pace
                ? `about ${job.pace.low} to ${job.pace.high} min for the ${job.pace.left} ${job.steps?.unit === "objective" ? "objectives" : "quests"} left (review, checks and merge not counted)`
                : undefined,
            ],
            // A job with no steps: how long its prompt usually takes (#Q4435).
            [
              "Usually",
              job.usual
                ? `${Math.round(job.usual.low / 6) / 10} to ${Math.round(job.usual.high / 6) / 10} min (last ${job.usual.runs} runs)`
                : undefined,
            ],
            [
              "Pace warning",
              job.pace?.warning
                ? "the steps left may not fit before the job's timeout"
                : undefined,
            ],
          ],
          sections: [
            ...(job.steps && job.steps.quests.length + job.steps.pending.length
              ? [
                  {
                    title: "Steps",
                    lines: [
                      ...job.steps.quests.map(
                        (quest) =>
                          `${quest.completedAt ? "[x]" : "[ ]"} #Q${quest.shortId} ${quest.title} (${quest.objectives.done}/${quest.objectives.total} objectives)`,
                      ),
                      ...job.steps.pending.map(
                        (quest) =>
                          `[ ] #Q${quest.shortId} ${quest.title} (not accepted yet)`,
                      ),
                    ],
                  },
                ]
              : []),
            ...(log
              ? [
                  { title: "stdout", lines: log.stdout.split("\n") },
                  { title: "stderr", lines: log.stderr.split("\n") },
                ]
              : []),
          ],
        });
      });
    },
  });

  public readonly cancel = $command({
    name: "cancel",
    description:
      "Stop a host job: a queued one ends at once, a running one is killed on its host",
    args: z.text({ title: "id", description: "The job's id." }),
    flags: z.object({ ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const job = await this.api.cancelJob({ params: { jobId: args } });
        this.render.written(
          print,
          flags.output,
          job,
          job.status === "cancelled"
            ? `Cancelled job ${job.id}`
            : `Asked ${job.hostSlug ?? "its host"} to stop job ${job.id}`,
        );
      });
    },
  });

  public readonly poke = $command({
    name: "poke",
    description:
      "Send a message to a running Claude Code job, read after the tool call it is running; without one, the Wake up preset",
    args: z.tuple([
      z.text({ title: "id", description: "The job's id." }),
      // A message, not a label: a bare `z.text()` caps at 255.
      z
        .text({
          title: "message",
          description:
            "What to tell the agent. Omitted: check your background watchers are alive, read the state directly, then carry on or finish.",
          size: "rich",
        })
        .optional(),
    ]),
    flags: z.object({ ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const [jobId, message] = args;
        const job = await this.api.pokeJob({
          params: { jobId },
          body: message ? { message } : {},
        });
        this.render.written(
          print,
          flags.output,
          job,
          `Sent a message to job ${job.id} on ${job.hostSlug ?? "its host"}`,
        );
      });
    },
  });

  public readonly logs = $command({
    name: "logs",
    description:
      "Print a job's output; with --follow, keep printing until it ends",
    args: z.text({ title: "id", description: "The job's id." }),
    flags: z.object({
      follow: z
        .boolean()
        .meta({ aliases: ["f"] })
        .describe("Keep printing until the job ends.")
        .optional(),
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        let after = { stdout: 0, stderr: 0 };
        for (;;) {
          const log = await this.api.getJobLog({
            params: { jobId: args },
            query: after,
          });
          for (const text of [log.stdout, log.stderr]) {
            if (text) print(text.replace(/\n$/, ""));
          }
          after = log.next;
          if (!flags.follow || !log.live) return;
          await this.dateTime.wait(this.pollMillis);
        }
      });
    },
  });

  public readonly job = $command({
    name: "job",
    description:
      "A project's host jobs (agent jobs on an Agent host): list, read, follow, poke and cancel",
    children: [this.list, this.get, this.cancel, this.poke, this.logs],
    handler: async ({ help }) => {
      help();
    },
  });
}
