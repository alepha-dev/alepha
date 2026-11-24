import type { AgentHostController, HostJobController } from "@lore/core/api";
import type { AgentRunController } from "@lore/plan/api";
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
 * `lore agent`: run a prompt on one of the project's Agent hosts, and list
 * them (#Q4225), the twins of `agent_run` and `agent_hosts`. A member drives
 * Lore's agent jobs from their own coding agent this way; `lore job` reads
 * and follows them.
 */
export class AgentCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * How often `--wait` asks for more of the log. A field so a spec can
   * shorten it.
   */
  protected pollMillis = 2_000;

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly runs = $client<AgentRunController>(this.client.scope());
  protected readonly hostsApi = $client<AgentHostController>(
    this.client.scope(),
  );
  protected readonly jobs = $client<HostJobController>(this.client.scope());

  public readonly run = $command({
    name: "run",
    description:
      "Run a prompt on an Agent host: triage (the inbox and the open errors), build --quest <n>, review-pr --pr <n> [--fix] [--trust], security-check, dependency-update [--text packages], or text --text '...'; --wait follows its log",
    args: z
      .enum([
        "triage",
        "build",
        "text",
        "review-pr",
        "security-check",
        "dependency-update",
      ])
      .meta({ title: "prompt" }),
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description: "The project, by slug or id. Defaults to LORE_PROJECT.",
        })
        .optional(),
      quest: z
        .integer()
        .describe(
          "The quest a build works, or the one a review-pr is about, by its number.",
        )
        .optional(),
      pr: z
        .integer()
        .describe("The pull request a review-pr reviews, by its number.")
        .optional(),
      fix: z
        .boolean()
        .describe(
          "A review-pr that pushes its fixes to the pull request's branch; refused for a fork",
        )
        .optional(),
      trust: z
        .boolean()
        .describe(
          "You trust the pull request's author: the host does not check that they can write to the repository first",
        )
        .optional(),
      text: z
        .text({
          description:
            "A text prompt's words, or the packages a dependency-update updates.",
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
            "The agent CLI (claude, gemini); needed when the host has several",
        })
        .optional(),
      model: z
        .text({
          description: "The model passed to the agent; absent, its default",
        })
        .optional(),
      workspace: z
        .text({
          description:
            "The workspace a text prompt runs in, kept on the host; text by default",
        })
        .optional(),
      source: z
        .enum(["none", "read", "write"])
        .describe(
          "The code the job finds: none, read (the repository at --ref, read-only) or write (a worktree on a branch Lore names). A build writes, the others read; a text run that changes code asks for write",
        )
        .optional(),
      ref: z
        .text({
          description:
            "The branch, tag, commit or pull/<n>/head the job's code is at; the default branch when absent",
        })
        .optional(),
      timeout: z
        .integer()
        .min(60)
        .max(7200)
        .describe("A text prompt's time, in seconds.")
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
        const { project, projectId } = await this.projects.named(
          flags.project,
          context,
        );
        const started = await this.runs.runAgent({
          params: { projectId },
          body: {
            prompt: args,
            ...(flags.quest === undefined ? {} : { quest: flags.quest }),
            ...(flags.pr === undefined ? {} : { pr: flags.pr }),
            ...(flags.fix ? { fix: true } : {}),
            ...(flags.trust ? { trust: true } : {}),
            ...(flags.text ? { text: flags.text } : {}),
            ...(flags.host ? { host: flags.host } : {}),
            ...(flags.agent ? { agent: flags.agent } : {}),
            ...(flags.model ? { model: flags.model } : {}),
            ...(flags.workspace ? { workspace: flags.workspace } : {}),
            ...(flags.source ? { source: flags.source } : {}),
            ...(flags.ref ? { ref: flags.ref } : {}),
            ...(flags.timeout ? { timeout: flags.timeout } : {}),
          },
        });
        const skipped = started.skipped.length
          ? `; left out for want of a member's trust: ${started.skipped.map((n) => `P${n}`).join(", ")}`
          : "";
        if (!started.jobId) {
          this.render.written(
            print,
            flags.output,
            started,
            `Nothing to run${skipped}`,
          );
          return;
        }
        const url = `${this.client.hostname()}/${project}/jobs/${started.jobId}`;
        if (!flags.wait) {
          this.render.written(
            print,
            flags.output,
            { ...started, url },
            `Started job ${started.jobId}${skipped}. Follow it with lore job logs ${started.jobId} --follow (${url})`,
          );
          return;
        }
        print(`Started job ${started.jobId}${skipped}`);
        let after = { stdout: 0, stderr: 0 };
        for (;;) {
          const log = await this.jobs.getJobLog({
            params: { jobId: started.jobId },
            query: after,
          });
          for (const text of [log.stdout, log.stderr]) {
            if (text) print(text.replace(/\n$/, ""));
          }
          after = log.next;
          if (!log.live) break;
          await this.dateTime.wait(this.pollMillis);
        }
        const job = await this.jobs.getJob({
          params: { jobId: started.jobId },
        });
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

  public readonly hosts = $command({
    name: "hosts",
    description:
      "The project's Agent hosts, each with its last check, its agent CLIs and the tools its jobs user has",
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description: "The project, by slug or id. Defaults to LORE_PROJECT.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const { items } = await this.hostsApi.listProjectAgentHosts({
          params: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, { hosts: items });
          return;
        }
        this.render.list(
          print,
          items.map((host) => ({
            handle: host.slug,
            title: host.status ?? "unchecked",
            fields: [
              host.agents.length
                ? `agents: ${host.agents.join(", ")}`
                : "no agent CLI",
              ...host.tools.map((tool) =>
                tool.found
                  ? `${tool.name} ${tool.error ? `(${tool.error})` : (tool.version ?? "")}`.trim()
                  : `${tool.name} missing`,
              ),
              ...(host.error ? [host.error] : []),
            ],
          })),
          undefined,
          "This project has no Agent host.",
        );
      });
    },
  });

  public readonly agent = $command({
    name: "agent",
    description:
      "Run a prompt on one of the project's Agent hosts, and list them",
    children: [this.run, this.hosts],
    handler: async ({ help }) => {
      help();
    },
  });
}
