import { $hook, $inject } from "alepha";
import { $repository } from "alepha/orm";

import { projects } from "../entities/projects.ts";
import { prompts } from "../entities/prompts.ts";
import type { ProjectEventFields } from "../schemas/projectEventFieldsSchema.ts";
import type { HostJobSummary } from "./HostJobs.ts";
import { LoreDatabase } from "./LoreDatabase.ts";
import { ProjectEventCatalog } from "./ProjectEventCatalog.ts";
import { ProjectEvents } from "./ProjectEvents.ts";
import { PromptRegistry } from "./PromptRegistry.ts";

/**
 * An agent job that ends (#E174, #Q4276): `agent.job.succeeded` and
 * `agent.job.failed` (failed or timed out), raised for every agent job,
 * started by a member, an event or the schedule. A job a member cancelled
 * raises neither.
 *
 * - **The member who started a run by hand is told in-app**, with no
 *   subscription to set up (`notifies: starter_id`), once even when also
 *   subscribed, and a click opens the job's page.
 * - Everyone else, and every triggered run, through a subscription: nobody
 *   is subscribed by default, so an hourly triage rings nobody unasked.
 *
 * Core, like the hosts, read with `host:read`.
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
  protected readonly projects = $repository(projects);
  protected readonly prompts = $repository(prompts);

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
        notifies: "starter_id",
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
      await this.raise(job);
    },
  });

  protected async raise(job: HostJobSummary): Promise<void> {
    const project = await this.projects.findOne({
      where: { id: { eq: job.projectId } },
    });
    if (!project) return;
    const started = job.startedAt ?? job.queuedAt;
    const duration = job.endedAt
      ? (Date.parse(job.endedAt) - Date.parse(started)) / 1000
      : 0;
    // A run by hand, or a job started before prompts recorded a cause by a
    // member and no automation: told to its starter.
    const byHand =
      job.cause?.kind === "hand" || (!job.cause && !job.automationId);
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
            : (job.cause?.kind ?? (job.automationId ? "automation" : "hand")),
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
        (it) => [it.reference, it.title].filter(Boolean).join(" ") || it.value,
      )
      .join(", ");
    return (args ? `${title} ${args}` : title).slice(0, 300);
  }
}
