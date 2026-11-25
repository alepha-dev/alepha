import {
  type AgentJobRequest,
  AgentJobs,
  HostJobService,
  ProjectSecurityService,
  PromptRegistry,
} from "@lore/core/api";
import {
  AgentTranscript,
  type HostJob,
  type PromptJobArg,
  type PromptJobCause,
  hostJobs,
  renderPromptText,
} from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ConflictError, ForbiddenError } from "alepha/server";

import { AgentJobService } from "./AgentJobService.ts";
import { AgentRunPreamble } from "./AgentRunPreamble.ts";
import { PromptService } from "./PromptService.ts";

/**
 * Run a prompt on an Agent host (#E174, #Q4275): one path for every prompt,
 * built-in or custom, by name, with a value per arg.
 *
 * - **The source is the prompt's**, never the run's: a run takes no source
 *   and no ref. On a project with no GitHub repository a prompt that reads
 *   or writes runs with none, working from Lore as runs always have.
 * - **Host, agent and model** fall back to the prompt's own, then to the
 *   project's only Agent host, the first agent CLI the host reports and the
 *   CLI's default model.
 * - **Permissions**: `host:read`, and the built-in's own (`quest:update` for
 *   a work prompt...), or `host:update` for a custom prompt, held by the
 *   starter.
 * - **One-shot**: a session id is minted per job, never resumed, unless the
 *   run continues a job that ended unfinished (#Q4340): it then runs on that
 *   job's host, in its workspace and on its branch, Bay reusing the worktree
 *   the job kept, and resumes its agent session when the job's agent got as
 *   far as reporting one.
 * - **One run at a time per prompt and per arg value**: a second is refused
 *   with the running job's id.
 * - What only the server knows is the built-in's `prepare`: its key's pin,
 *   its workspace, the items a triage is given.
 *
 * The job records the prompt's name, its args and its cause; the reply
 * comes with the job's end (#Q4288).
 */
export class PromptRunService {
  protected readonly prompts = $inject(PromptService);
  protected readonly registry = $inject(PromptRegistry);
  protected readonly agents = $inject(AgentJobs);
  protected readonly jobService = $inject(AgentJobService);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly jobs = $repository(hostJobs);
  protected readonly hostJobs = $inject(HostJobService);

  /**
   * The statuses a job can be continued from: it ended, and not done.
   */
  public static readonly CONTINUABLE = ["failed", "timed_out", "cancelled"];

  public async run(
    projectId: number,
    user: UserAccountToken,
    name: string,
    body: PromptRunBody,
    cause: PromptJobCause = { kind: "hand" },
    startedByJobId?: string,
  ): Promise<{ jobId: string; skipped: number[] }> {
    const prompt = await this.prompts.get(projectId, name);
    for (const permission of ["host:read", prompt.permission]) {
      if (!(await this.security.holds(projectId, user.id, permission))) {
        throw new ForbiddenError(
          `A run of ${name} needs the ${permission} permission`,
        );
      }
    }
    if ((body.fix || body.trust) && name !== "review-pr") {
      throw new BadRequestError("Only review-pr takes fix and trust");
    }
    if ((body.fix || body.trust) && cause.kind !== "hand") {
      throw new BadRequestError("fix and trust are a run by hand's only");
    }
    const previous = body.continue
      ? await this.continuable(projectId, name, body)
      : undefined;
    const { values, items } = await this.prompts.resolveArgs(
      projectId,
      user,
      prompt,
      body.args ??
        (previous
          ? Object.fromEntries(
              (previous.args ?? []).map((arg) => [arg.name, arg.value]),
            )
          : {}),
    );
    const args: PromptJobArg[] = items.map(({ arg, value, item }) => ({
      name: arg.name,
      type: arg.type,
      value: String(item.fields.number ?? item.fields.id ?? value).slice(
        0,
        120,
      ),
      ...(item.fields.reference
        ? { reference: String(item.fields.reference).slice(0, 120) }
        : {}),
      ...(item.fields.title || item.fields.name
        ? {
            title: String(item.fields.title ?? item.fields.name).slice(0, 300),
          }
        : {}),
    }));
    await this.assertSingleFlight(projectId, name, args);

    const text = renderPromptText(prompt.text, values);
    const repository = await this.jobService.repositoryOf(projectId);
    const source =
      prompt.source === "none" || !repository
        ? { mode: "none" as const }
        : {
            mode: prompt.source,
            ...(prompt.ref ? { ref: prompt.ref } : {}),
          };
    const builtin = prompt.builtin ? this.registry.get(name) : undefined;
    const plan =
      (await builtin?.prepare?.({
        projectId,
        startedBy: user.id,
        prompt,
        text,
        items,
        options: {
          ...(body.fix ? { fix: true } : {}),
          ...(body.trust ? { trust: true } : {}),
        },
        cause,
        source,
      })) ?? {};
    const { after, skipped, ...changes } = plan;
    const host = previous?.hostId ?? body.host ?? prompt.host;
    const agent = body.agent ?? previous?.input.agent ?? prompt.agent;
    const model = body.model ?? prompt.model;
    const resumed = previous
      ? await this.resumeOf(previous, changes.source ?? source)
      : undefined;
    const job = await this.agents.start({
      projectId,
      prompt: [AgentRunPreamble.MARKER, "", text].join("\n"),
      ...(host ? { host } : {}),
      ...(agent ? { agent } : {}),
      ...(model ? { model } : {}),
      firstAgent: true,
      source,
      timeoutSeconds: prompt.timeoutSeconds,
      startedBy: user.id,
      // The job whose event started a triggered run: the chain guard reads
      // it (#Q4277).
      ...(startedByJobId ? { startedByJobId } : {}),
      subjectType: "prompt",
      subjectId: name,
      ...changes,
      ...resumed,
      record: { prompt: name, args, cause },
    });
    await after?.(job.id);
    return { jobId: job.id, skipped: skipped ?? [] };
  }

  /**
   * The job a run continues (#Q4340): one of this project's agent jobs of
   * this prompt that ended unfinished. Its host is the run's whatever the
   * request names, since its workspace is there.
   */
  protected async continuable(
    projectId: number,
    name: string,
    body: PromptRunBody,
  ): Promise<HostJob> {
    const previous = await this.jobs.findOne({
      where: { id: { eq: body.continue as string } },
    });
    if (!previous || previous.projectId !== projectId) {
      throw new BadRequestError(`No job ${body.continue} in this project`);
    }
    if (previous.kind !== "agent" || previous.prompt !== name) {
      throw new BadRequestError(
        `Job ${previous.id} is not a run of ${name}: only a run of the same prompt continues it`,
      );
    }
    if (!PromptRunService.CONTINUABLE.includes(previous.status)) {
      throw new BadRequestError(
        `Job ${previous.id} ${previous.status === "succeeded" ? "succeeded" : "has not ended"}: only a job that failed, timed out or was cancelled is continued, run the prompt afresh instead`,
      );
    }
    return previous;
  }

  /**
   * What a continued run takes from the job it continues: its workspace,
   * its write branch with Bay told to reuse the worktree it kept, and its
   * agent session, resumed when the job's log shows the agent reported it
   * (a job that failed before its agent started has none to resume).
   */
  protected async resumeOf(
    previous: HostJob,
    source: NonNullable<AgentJobRequest["source"]>,
  ): Promise<Pick<AgentJobRequest, "workspace" | "source" | "session">> {
    const kept = previous.input.source;
    const out: Pick<AgentJobRequest, "workspace" | "source" | "session"> = {};
    if (previous.input.workspace) out.workspace = previous.input.workspace;
    if (source.mode === "write" && kept?.mode === "write" && kept.branch) {
      out.source = { ...source, branch: kept.branch, resume: true };
    }
    const session = previous.input.session;
    if (session) {
      const stdout = await this.hostJobs
        .text(previous.id, "stdout")
        .catch(() => "");
      const started = AgentTranscript.parse(
        stdout,
        previous.input.agent,
      ).entries.some((entry) => entry.kind === "session");
      if (started) out.session = { id: session.id, resume: true };
    }
    return out;
  }

  /**
   * One run at a time per prompt and per arg value.
   */
  protected async assertSingleFlight(
    projectId: number,
    name: string,
    args: PromptJobArg[],
  ): Promise<void> {
    const keyOf = (list: PromptJobArg[] | undefined | null) =>
      JSON.stringify(
        (list ?? [])
          .map((it) => `${it.name}=${it.value}`)
          .sort((a, b) => a.localeCompare(b)),
      );
    const key = keyOf(args);
    const running = await this.jobs.findMany({
      where: {
        projectId: { eq: projectId },
        prompt: { eq: name },
        status: { inArray: ["queued", "running"] },
      },
    });
    const same = running.find((job) => keyOf(job.args) === key);
    if (same) {
      throw new ConflictError(
        `A run of ${name}${args.length ? ` for ${args.map((it) => it.reference ?? it.value).join(", ")}` : ""} is already ${same.status}: job ${same.id}`,
      );
    }
  }
}

/**
 * A run's request: a value per arg, and where it runs. No source and no
 * ref: those are the prompt's.
 */
export interface PromptRunBody {
  args?: Record<string, string>;
  host?: string;
  agent?: string;
  model?: string;
  /**
   * `review-pr` only, by hand only: a write job at the pull request's head,
   * and a member vouching for an outside author.
   */
  fix?: boolean;
  trust?: boolean;
  /**
   * The job this run continues (#Q4340): one of the prompt's runs that
   * failed, timed out or was cancelled. Its args stand when none are given.
   */
  continue?: string;
}
