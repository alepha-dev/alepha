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
 * `job_list`, `job_get` and `job_cancel`, plus `logs`, which follows a
 * running job's output until it ends.
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
            ["Model", job.input.model],
            ["Workspace", job.input.workspace],
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
          ],
          ...(log
            ? {
                sections: [
                  { title: "stdout", lines: log.stdout.split("\n") },
                  { title: "stderr", lines: log.stderr.split("\n") },
                ],
              }
            : {}),
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
      "A project's host jobs (agent jobs on an Agent host): list, read, follow and cancel",
    children: [this.list, this.get, this.cancel, this.logs],
    handler: async ({ help }) => {
      help();
    },
  });
}
