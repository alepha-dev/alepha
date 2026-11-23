import { AlephaError } from "alepha";

import type { HostJobKind, HostJobStatus } from "../schemas/hostJobValues.ts";

declare module "alepha" {
  interface Hooks {
    /**
     * A host job reached a terminal status (#Q3984): succeeded, failed,
     * cancelled or timed out. Emitted by the queue; core revokes the job's
     * key, and a check's end sets its Agent host's state.
     */
    "host:job:ended": { job: HostJobSummary };
  }
}

/**
 * What a module asks a host to run.
 *
 * `input` is the job's structured spec without its credential: the agent and
 * its model, the workspace, the rendered prompt and the timeout. The credential a job holds is minted
 * when the machine pulls the spec, through {@link HostJobKeyIssuer}, so no
 * row ever stores it.
 */
export interface HostJobRequest {
  projectId: number;
  hostId: string;
  kind: HostJobKind;
  input: HostJobInput;
  /** The member who started it; their rank bounds the job's key. */
  startedBy?: string;
  /** The job whose output started this one, for the chain guard. */
  startedByJobId?: string;
  /** What the job is about, for its page and its list: a feedback, a quest. */
  subjectType?: string;
  subjectId?: string;
}

/**
 * The spec a job carries, Lore's half of Bay's `jobSpec` (#Q4222): the
 * agent and its model, the workspace, the prompt and the timeout. Bay
 * validates every field again and builds the command line from its adapter
 * for the agent.
 */
export interface HostJobInput {
  /**
   * The agent CLI the job runs, by the name of Bay's adapter (`claude`,
   * `gemini`, #Q4219), and the model passed to it; no model leaves the
   * CLI's own default.
   */
  agent?: string;
  model?: string;
  /**
   * The workspace an agent job runs in on the host (#Q4218), a short key
   * such as `triage` or `q12`: Bay runs it in
   * `<jobs base>/<project slug>/<workspace>`, kept between runs.
   */
  workspace?: string;
  prompt?: string;
  timeoutSeconds: number;
  /**
   * What the job's key is pinned to, minted at pull time. Absent for a job
   * that holds no key (a check).
   */
  key?: HostJobKeyScope;
}

/**
 * The pins of a job key (#Q3995): one project always, and optionally one
 * quest, a set of feedback items or one epic. The key reaches Lore's MCP
 * only, and any tool its owner's rank allows within those pins (#Q4222).
 */
export interface HostJobKeyScope {
  questId?: number;
  feedbackId?: number;
  /**
   * A set of feedback items instead of one (#Q4183): the global triage
   * reaches the pending items it was given, and no other.
   */
  feedbackIds?: number[];
  /**
   * An epic review's epic (#Q4214), by number: `epic_*` tools reach it only,
   * creates file under it, quest writes touch its quests only.
   */
  epicId?: number;
}

export interface HostJobSummary {
  id: string;
  projectId: number;
  hostId?: string;
  kind: HostJobKind;
  status: HostJobStatus;
  startedBy?: string;
  startedByJobId?: string;
  subjectType?: string;
  subjectId?: string;
  reason?: string;
  exitCode?: number;
  queuedAt: string;
  startedAt?: string;
  endedAt?: string;
  input: HostJobInput;
}

/**
 * What mints a job's credential when the machine pulls its spec: the job
 * key of #Q3995, registered by core's key service. Answers the key's
 * plaintext once; the row holds its hash.
 */
export interface HostJobKeyIssuer {
  mint(job: HostJobSummary, scope: HostJobKeyScope): Promise<string>;
  revoke(jobId: string): Promise<void>;
}

/**
 * The implementation Ship registers: the `host_jobs` queue.
 */
export interface HostJobQueue {
  start(request: HostJobRequest): Promise<HostJobSummary>;
  get(jobId: string): Promise<HostJobSummary | undefined>;
  /** The project's job on a subject that is still queued or running. */
  active(
    projectId: number,
    subjectType: string,
    subjectId: string,
  ): Promise<HostJobSummary | undefined>;
  cancel(jobId: string, by?: string): Promise<HostJobSummary>;
  /** Whether the chain behind a job already holds a job of this kind. */
  chainHolds(jobId: string, kind: HostJobKind): Promise<boolean>;
  /**
   * Asks the hosts that ran the project's agent jobs to delete a workspace,
   * or all of them (#Q4218). Answers how many hosts were asked.
   */
  removeWorkspaces(projectId: number, workspace?: string): Promise<number>;
}

/**
 * A project's Agent host as an agent kind sees it.
 */
export interface AgentHostRef {
  id: string;
  slug: string;
  status?: string;
  /**
   * The agent CLIs the host's inventory reports as answering (#Q4220), by
   * adapter name. Undefined when it reported none yet.
   */
  agents?: string[];
  runner?: string;
}

/**
 * What core's Agent host service registers (#Q3985): the host a project's
 * agent jobs run on.
 */
export interface AgentHostDirectory {
  defaultFor(projectId: number): Promise<AgentHostRef | undefined>;
}

/**
 * The port other modules start a host job through (#Q3984): jobs live in
 * Ship, beside `hosts` and `host_commands`, and no feature module imports
 * another, so the queue registers here and the agent kind (core's
 * `AgentJobService`) reaches it through this class. With Ship absent, starting a job throws:
 * there is no host to run it on.
 *
 * The key issuer is core's own (#Q3995), registered beside it.
 */
export class HostJobs {
  protected queue?: HostJobQueue;
  protected issuer?: HostJobKeyIssuer;
  protected agents?: AgentHostDirectory;

  public registerAgentHosts(agents: AgentHostDirectory): void {
    if (this.agents) {
      throw new AlephaError("An Agent host directory is already registered");
    }
    this.agents = agents;
  }

  /**
   * The project's default Agent host when it may still run its agent jobs,
   * or undefined: the agent buttons hide, and an agent job refuses to start.
   */
  public async agentHostFor(
    projectId: number,
  ): Promise<AgentHostRef | undefined> {
    return this.agents?.defaultFor(projectId);
  }

  /**
   * Asks the hosts that ran a workspace's jobs to delete it (#Q4218): a
   * quest's build directory once the quest is done. Nothing without Ship.
   */
  public async removeWorkspaces(
    projectId: number,
    workspace?: string,
  ): Promise<number> {
    return (await this.queue?.removeWorkspaces(projectId, workspace)) ?? 0;
  }

  public registerQueue(queue: HostJobQueue): void {
    if (this.queue) {
      throw new AlephaError("A host job queue is already registered");
    }
    this.queue = queue;
  }

  public registerKeyIssuer(issuer: HostJobKeyIssuer): void {
    if (this.issuer) {
      throw new AlephaError("A host job key issuer is already registered");
    }
    this.issuer = issuer;
  }

  public get available(): boolean {
    return this.queue !== undefined;
  }

  public async start(request: HostJobRequest): Promise<HostJobSummary> {
    return this.need().start(request);
  }

  public async get(jobId: string): Promise<HostJobSummary | undefined> {
    return this.queue?.get(jobId);
  }

  public async active(
    projectId: number,
    subjectType: string,
    subjectId: string,
  ): Promise<HostJobSummary | undefined> {
    return this.queue?.active(projectId, subjectType, subjectId);
  }

  public async cancel(jobId: string, by?: string): Promise<HostJobSummary> {
    return this.need().cancel(jobId, by);
  }

  public async chainHolds(jobId: string, kind: HostJobKind): Promise<boolean> {
    return (await this.queue?.chainHolds(jobId, kind)) ?? false;
  }

  /**
   * Mints the job's key, or answers undefined when no issuer is registered:
   * the spec then carries no key, and Bay refuses an agent job without one.
   */
  public async mintKey(
    job: HostJobSummary,
    scope: HostJobKeyScope,
  ): Promise<string | undefined> {
    return this.issuer?.mint(job, scope);
  }

  public async revokeKey(jobId: string): Promise<void> {
    await this.issuer?.revoke(jobId);
  }

  protected need(): HostJobQueue {
    if (!this.queue) {
      throw new AlephaError(
        "No host job queue is registered: Ship runs host jobs",
      );
    }
    return this.queue;
  }
}
