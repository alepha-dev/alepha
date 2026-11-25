import { $inject, AlephaError } from "alepha";

import { AgentJobsUnavailableError } from "../errors/AgentJobsUnavailableError.ts";
import type { HostJobSource } from "../schemas/hostJobInputSchema.ts";
import type { PromptJobArg } from "../schemas/promptJobArgSchema.ts";
import type { PromptJobCause } from "../schemas/promptJobCauseSchema.ts";
import type { AgentHostRef, HostJobSummary } from "./HostJobs.ts";
import { ProjectSecurityService } from "./ProjectSecurityService.ts";

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
 * What starts an agent job: the runner `@lore/prompts` registers on
 * {@link AgentJobs} (#E175).
 */
export interface AgentJobRunner {
  start(request: AgentJobRequest): Promise<HostJobSummary>;
  resolve(
    projectId: number,
    run: { host?: string; agent?: string; firstAgent?: boolean },
  ): Promise<{ host: AgentHostRef; agent?: string }>;
  choices(projectId: number): Promise<Array<{ host: string; agent?: string }>>;
}

/**
 * The port feature modules start an agent job through (#Q4222), filled by
 * registration since #E175: Plan, Ship and Requirements contribute prompts
 * and read {@link choices}, and a feature package never imports another, so
 * the runner (`@lore/prompts`'s `AgentJobService`) registers here, as
 * Ship's queue registers on `HostJobs`.
 *
 * Unfilled, {@link available} is false, {@link choices} answers `[]` (so
 * every agent entry hides) and {@link start} throws
 * {@link AgentJobsUnavailableError}. The same holds for a project with the
 * `prompts` capability off (#Q4314): only the asking project's switch
 * decides, never the host's, which may be lent to it.
 */
export class AgentJobs {
  /**
   * Where a prompt wants the run's preamble (#Q4224): replaced when the job
   * starts, once its source is known. Part of the contract, since Plan's
   * prompts place it.
   */
  public static readonly PREAMBLE_MARKER = "<<<LORE_AGENT_RUN_PREAMBLE>>>";

  protected readonly security = $inject(ProjectSecurityService);
  protected runner?: AgentJobRunner;

  public register(runner: AgentJobRunner): void {
    if (this.runner) {
      throw new AlephaError("An agent job runner is already registered");
    }
    this.runner = runner;
  }

  public get available(): boolean {
    return this.runner !== undefined;
  }

  public async start(request: AgentJobRequest): Promise<HostJobSummary> {
    return (await this.need(request.projectId)).start(request);
  }

  /**
   * The host and agent a run would use, or the refusal that says which to
   * name (#Q4223).
   */
  public async resolve(
    projectId: number,
    run: { host?: string; agent?: string; firstAgent?: boolean },
  ): Promise<{ host: AgentHostRef; agent?: string }> {
    return (await this.need(projectId)).resolve(projectId, run);
  }

  /**
   * The hosts and agents a run of this project may pick from (#Q4223):
   * none without a runner, or with Prompts off.
   */
  public async choices(
    projectId: number,
  ): Promise<Array<{ host: string; agent?: string }>> {
    if (!this.runner || !(await this.isOn(projectId))) return [];
    return this.runner.choices(projectId);
  }

  /**
   * Whether the project has the `prompts` capability on (#Q4314).
   */
  public async isOn(projectId: number): Promise<boolean> {
    return this.security.hasCapability(
      await this.security.capabilitiesOf(projectId),
      "prompts",
    );
  }

  protected async need(projectId: number): Promise<AgentJobRunner> {
    if (!this.runner || !(await this.isOn(projectId))) {
      throw new AgentJobsUnavailableError();
    }
    return this.runner;
  }
}
