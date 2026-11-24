import { $inject } from "alepha";

import type { HostJobSource } from "../schemas/hostJobInputSchema.ts";
import type { PromptJobArg } from "../schemas/promptJobArgSchema.ts";
import type { PromptJobCause } from "../schemas/promptJobCauseSchema.ts";
import { AgentJobService } from "./AgentJobService.ts";
import type { AgentHostRef, HostJobSummary } from "./HostJobs.ts";

/**
 * What a feature module asks of an agent job (#Q3988, #Q3989, light since
 * #Q4222): a prompt, the agent and model to run it with, the workspace it
 * runs in, and what the job is about, which pins its key.
 */
export interface AgentJobRequest {
  projectId: number;
  prompt: string;
  /**
   * The Agent host, by slug or id (#Q4223): absent, the project's only one.
   */
  host?: string;
  /**
   * The agent CLI, by Bay's adapter name (`claude`, `gemini`), and its
   * model. Absent, the host's only agent and the CLI's own default model.
   */
  agent?: string;
  model?: string;
  /**
   * With no agent named, the first agent CLI the host reports rather than a
   * refusal when it reports several (#Q4275): a prompt's run.
   */
  firstAgent?: boolean;
  /**
   * A prompt's run (#Q4275): the prompt's name, its args as run and what
   * started it, recorded on the job. A run gets a session id of its own,
   * never resumed, so "continue" can come later.
   */
  record?: { prompt: string; args: PromptJobArg[]; cause: PromptJobCause };
  /**
   * The workspace the job runs in on the host (#Q4218): `q<n>` for a
   * quest's work, `job-<id>` for another write job, `triage` otherwise,
   * unless the caller names one.
   */
  workspace?: string;
  /**
   * The code the job asks for (#E173), as a member asked: `read` or `write`
   * is refused when the project has no GitHub repository or the host's Bay
   * predates sources. Absent, {@link defaultSource} applies.
   */
  source?: {
    mode: HostJobSource["mode"];
    ref?: string;
    branch?: string;
    /**
     * A job at `pull/<n>/head` whose author must be able to write to the
     * repository (#Q4251); absent is a member's trust.
     */
    trust?: "pr-author-writes";
  };
  /**
   * What the job needs when the request names no source: `write` for a
   * quest's build, `read` for everything else. Falls back to `none` on a
   * project with no GitHub repository, where today's runs work from Lore.
   */
  defaultSource?: "read" | "write";
  /**
   * A chat agent's turn (#Q4250): the CLI's JSON result, and the
   * conversation it starts or resumes.
   */
  output?: "json";
  session?: { id: string; resume?: boolean };
  /** The job's time, clamped by `AgentJobService.timeoutOf`. */
  timeoutSeconds?: number;
  questNumber?: number;
  feedbackNumber?: number;
  /** The global triage's items (#Q4183), instead of `feedbackNumber`. */
  feedbackNumbers?: number[];
  /** An epic review's epic (#Q4214), by number: the key is pinned to it. */
  epicNumber?: number;
  startedBy?: string;
  /**
   * The job whose output started this one. Set on its own when a job key
   * makes the request (#Q4222), so the chain guard holds.
   */
  startedByJobId?: string;
  subjectType: string;
  subjectId: string;
  /** Text from outside the team no member trusted: refused. */
  untrusted?: boolean;
}

/**
 * The port feature modules start an agent job through: core's own
 * {@link AgentJobService} since #Q4222, so Plan needs neither Build nor Ship
 * to ask for one.
 */
export class AgentJobs {
  protected readonly service = $inject(AgentJobService);

  public get available(): boolean {
    return true;
  }

  public async start(request: AgentJobRequest): Promise<HostJobSummary> {
    return this.service.start(request);
  }

  /**
   * The host and agent a run would use, or the refusal that says which to
   * name (#Q4223).
   */
  public async resolve(
    projectId: number,
    run: { host?: string; agent?: string; firstAgent?: boolean },
  ): Promise<{ host: AgentHostRef; agent?: string }> {
    return this.service.resolve(projectId, run);
  }

  /**
   * The hosts and agents a run of this project may pick from (#Q4223).
   */
  public async choices(
    projectId: number,
  ): Promise<Array<{ host: string; agent?: string }>> {
    return this.service.choices(projectId);
  }
}
