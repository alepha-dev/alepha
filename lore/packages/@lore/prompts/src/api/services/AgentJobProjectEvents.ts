import {
  AgentJobs,
  type HostJobSummary,
  LoreDatabase,
  ProjectEventCatalog,
  ProjectEvents,
  PromptRegistry,
} from "@lore/core/api";
import { type ProjectEventFields, projects } from "@lore/core/schemas";
import { $hook, $inject } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { prompts } from "../entities/prompts.ts";

/**
 * An agent job that ends (#E174, #Q4276): `agent.job.succeeded` and
 * `agent.job.failed` (failed or timed out), raised for every agent job,
 * started by a member, an event or the schedule. A job a member cancelled
 * raises neither.
 *
 * - **Nobody is told without a subscription**, not even the member who
 *   started the run (#Q4307, at the owner's request): a subscription to
 *   **Agent job succeeded** or **Agent job failed** is what tells a member,
 *   once, and a click opens the job's page. Until then a run by hand told
 *   its starter in-app by itself (`notifies: starter_id`), which rang for
 *   runs nobody asked to hear about.
 * - `starter_id` is still a field of the event, the member who started a
 *   run by hand, for a channel's message or a later "jobs I started" filter.
 *
 * A job that failed or timed out is also logged at error level (#Q4329),
 * which the app's sigil files in Errors: nobody watches an agent job run,
 * so its failure would otherwise be silent. The message names only the
 * prompt and the kind (`Agent job work-epic timed out`), so repeats bump one
 * error; the job, the host and the reason go in the log's data.
 *
 * Read with `host:read`, like the hosts, and offered only while the project
 * has the `prompts` capability (#E175): off, no agent job runs.
 */
export class AgentJobProjectEvents {
  protected static readonly DEFINITIONS = [
    {
      name: "agent.job.succeeded",
      label: "Agent job succeeded",
      outcome: "succeeded",
    },
    {
      name: "agent.job.failed",
      label: "Agent job failed",
      outcome: "failed",
    },
  ] as const;

  protected readonly catalog = $inject(ProjectEventCatalog);
  protected readonly events = $inject(ProjectEvents);
  protected readonly database = $inject(LoreDatabase);
  protected readonly registry = $inject(PromptRegistry);
  protected readonly agents = $inject(AgentJobs);
  protected readonly projects = $repository(projects);
  protected readonly prompts = $repository(prompts);
  protected readonly log = $logger();

  constructor() {
    for (const definition of AgentJobProjectEvents.DEFINITIONS)
      this.catalog.register({
        name: definition.name,
        label: definition.label,
        resource: "jobs",
        subject: "job",
        fields: {
          job_id: "text",
          prompt: "text",
          cause: "text",
          host: "text",
          duration_secs: "number",
          reason: "text",
          reply: "text",
          starter_id: "member",
        },
        permission: "host:read",
        needs: { capability: "prompts" },
        message: (it) => this.message(it, definition.outcome),
      });
  }

  /**
   * "Triage feedback and errors succeeded in 1 min 12 s", then the reply's
   * first line, or the reason.
   */
  protected message(
    fields: ProjectEventFields,
    outcome: "succeeded" | "failed",
  ): { title: string; text: string } {
    const text = (key: string) =>
      typeof fields[key] === "string" ? (fields[key] as string) : "";
    const seconds =
      typeof fields.duration_secs === "number" ? fields.duration_secs : 0;
    const timedOut = text("reason").includes("timeout");
    return {
      title: `${text("title") || "Agent job"} ${
        outcome === "succeeded"
          ? "succeeded"
          : timedOut
            ? "timed out"
            : "failed"
      } in ${AgentJobProjectEvents.duration(seconds)}`,
      text:
        outcome === "succeeded"
          ? text("reply") || "It ended with no reply."
          : text("reason") || "Read the job's log for why.",
    };
  }

  /**
   * `1 min 12 s`, `45 s`, `2 h 3 min`.
   */
  public static duration(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) return `${s} s`;
    const minutes = Math.floor(s / 60);
    if (minutes < 60) return `${minutes} min ${s % 60} s`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }

  protected readonly onJobEnded = $hook({
    on: "host:job:ended",
    handler: async ({ job }) => {
      if (job.kind !== "agent") return;
      if (
        job.status !== "succeeded" &&
        job.status !== "failed" &&
        job.status !== "timed_out"
      ) {
        return;
      }
      // Reported whatever the capability: a failure is one either way.
      if (job.status !== "succeeded") this.report(job);
      // A job still running when Prompts was turned off finishes; its end
      // tells nobody (#Q4314).
      if (!(await this.agents.isOn(job.projectId))) return;
      await this.raise(job);
    },
  });

  /**
   * The error Errors shows for a failed or timed-out agent job (#Q4329).
   * Stable per prompt and kind: a job id, a duration or a reason in the
   * message would make every run its own error.
   */
  protected report(job: HostJobSummary): void {
    const prompt = job.prompt ?? job.subjectType ?? "run";
    const kind = job.status === "timed_out" ? "timed out" : "failed";
    this.log.error(`Agent job ${prompt} ${kind}`, {
      projectId: job.projectId,
      jobId: job.id,
      prompt,
      host: job.hostId ?? "",
      status: job.status,
      reason: (
        job.reason ??
        (job.status === "timed_out" ? "It ran past its timeout" : "")
      ).slice(0, 500),
    });
  }

  protected async raise(job: HostJobSummary): Promise<void> {
    const project = await this.projects.findOne({
      where: { id: { eq: job.projectId } },
    });
    if (!project) return;
    const started = job.startedAt ?? job.queuedAt;
    const duration = job.endedAt
      ? (Date.parse(job.endedAt) - Date.parse(started)) / 1000
      : 0;
    // A run by hand, or a job a member started with no prompt (a text run):
    // its starter, as a field, never an implicit recipient (#Q4307).
    const byHand = !job.cause || job.cause.kind === "hand";
    const reply = (job.result ?? "")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);
    const recorded = await this.events.emit({
      projectId: job.projectId,
      name:
        job.status === "succeeded" ? "agent.job.succeeded" : "agent.job.failed",
      subjectId: job.id,
      jobId: job.id,
      fields: {
        project: project.title,
        title: await this.titleOf(job),
        url: `/${project.slug || `project-${project.id}`}/jobs/${job.id}`,
        job_id: job.id,
        prompt: job.prompt ?? job.subjectType ?? "",
        cause:
          job.cause?.kind === "event"
            ? `event ${job.cause.event ?? ""}`.trim()
            : (job.cause?.kind ?? "hand"),
        host: job.hostId ?? "",
        duration_secs: Math.round(duration),
        ...(job.status === "succeeded"
          ? reply
            ? { reply: reply.slice(0, 300) }
            : {}
          : {
              reason: (
                job.reason ??
                (job.status === "timed_out" ? "It ran past its timeout" : "")
              ).slice(0, 500),
            }),
        ...(byHand && job.startedBy ? { starter_id: job.startedBy } : {}),
      },
    });
    await this.database.batch(recorded.statements);
    await recorded.committed();
  }

  /**
   * The prompt and its args as a person says them: "Work on quest #Q12
   * Fix the cart".
   */
  protected async titleOf(job: HostJobSummary): Promise<string> {
    if (!job.prompt)
      return job.subjectType ? `Agent job (${job.subjectType})` : "Agent job";
    const builtin = this.registry.get(job.prompt);
    const row = builtin
      ? undefined
      : await this.prompts.findOne({
          where: { projectId: { eq: job.projectId }, name: { eq: job.prompt } },
        });
    const title = builtin?.title ?? row?.title ?? job.prompt;
    const args = (job.args ?? [])
      .map(
        // A member arg is named by its name, never by its id.
        (it) =>
          [it.reference, it.title].filter(Boolean).join(" ") ||
          (it.type === "member" ? "" : it.value),
      )
      .filter(Boolean)
      .join(", ");
    return (args ? `${title} ${args}` : title).slice(0, 300);
  }
}
