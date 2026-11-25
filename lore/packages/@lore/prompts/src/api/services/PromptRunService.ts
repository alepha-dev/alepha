import {
  AgentJobs,
  ProjectSecurityService,
  PromptRegistry,
} from "@lore/core/api";
import {
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
 * - **One-shot**: a session id is minted per job, never resumed.
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
    const { values, items } = await this.prompts.resolveArgs(
      projectId,
      user,
      prompt,
      body.args ?? {},
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
    const host = body.host ?? prompt.host;
    const agent = body.agent ?? prompt.agent;
    const model = body.model ?? prompt.model;
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
      record: { prompt: name, args, cause },
    });
    await after?.(job.id);
    return { jobId: job.id, skipped: skipped ?? [] };
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
}
