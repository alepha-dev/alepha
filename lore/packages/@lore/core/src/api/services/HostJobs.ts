import { AlephaError } from "alepha";

import type { HostJobSource } from "../schemas/hostJobInputSchema.ts";
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
  /**
   * The job's id, when the caller needs it before the row exists: a write
   * job's branch `lore/job-<id>` is named from it (#Q4248).
   */
  id?: string;
  projectId: number;
  hostId: string;
  kind: HostJobKind;
  input: HostJobInput;
  /** The member who started it; their rank bounds the job's key. */
  startedBy?: string;
  /** The job whose output started this one, for the chain guard. */
  startedByJobId?: string;
  /** The agent automation that started it (#Q4226). */
  automationId?: string;
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
  /**
   * The code the job finds when it starts (#E173): none, a read-only
   * checkout, or a worktree to change. Absent is `none`.
   */
  source?: HostJobSource;
  /**
   * `json` for a job whose answer is read when it ends (#Q4250): the CLI
   * prints one JSON result instead of its stream.
   */
  output?: "json";
  /**
   * The conversation the run starts, or resumes (#Q4250).
   */
  session?: { id: string; resume?: boolean };
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
  automationId?: string;
  subjectType?: string;
  subjectId?: string;
  reason?: string;
  exitCode?: number;
  /** The commit its source resolved, from the host's terminal ack. */
  commit?: string;
  /** A kept worktree's sentence, from the host's terminal ack. */
  warning?: string;
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
  /**
   * One stream of a job's log, whole (#Q4250): what a chat agent's answer
   * is read from once its job ended. Nothing else reads an agent's output.
   */
  text(jobId: string, stream: "stdout" | "stderr"): Promise<string>;
  /** The project's job on a subject that is still queued or running. */
  active(
    projectId: number,
    subjectType: string,
    subjectId: string,
  ): Promise<HostJobSummary | undefined>;
  cancel(jobId: string, by?: string): Promise<HostJobSummary>;
  /** An automation's jobs that are still queued or running (#Q4226). */
  activeForAutomation(automationId: string): Promise<HostJobSummary[]>;
  /**
   * The subjects of every job an automation ever started, whatever their
   * outcome (#Q4229): a quest a build automation built is never picked
   * again.
   */
  subjectsOfAutomation(
    automationId: string,
    subjectType: string,
  ): Promise<string[]>;
  /**
   * How many jobs automations started since an instant (#Q4230): one
   * automation's, or a project's of one subject type (its builds).
   */
  countAutomationJobs(filter: AutomationJobCount): Promise<number>;
  /**
   * The jobs an automation started on these subjects of a project (#Q4234),
   * newest first: whether a quest was built by one.
   */
  automationJobsOn(
    projectId: number,
    subjectType: string,
    subjectIds: string[],
  ): Promise<HostJobSummary[]>;
  /** Whether the chain behind a job already holds a job of this kind. */
  chainHolds(jobId: string, kind: HostJobKind): Promise<boolean>;
  /**
   * Asks the hosts that ran the project's agent jobs to delete a workspace,
   * or all of them (#Q4218). Answers how many hosts were asked.
   */
  removeWorkspaces(projectId: number, workspace?: string): Promise<number>;
}

/**
 * Which automation jobs {@link HostJobQueue.countAutomationJobs} counts.
 */
export interface AutomationJobCount {
  since: string;
  automationId?: string;
  projectId?: number;
  subjectType?: string;
}

/**
 * A project's Agent host as an agent kind sees it.
 */
export interface AgentHostRef {
  id: string;
  slug: string;
  status?: string;
  /** Past its grace period without reporting (#Q3733): `host.offline`. */
  offline?: boolean;
  /**
   * The agent CLIs the host's inventory reports as answering (#Q4220), by
   * adapter name. Undefined when it reported none yet.
   */
  agents?: string[];
  /**
   * The host's Bay prepares a job's source (#E173). A read or write job is
   * refused on a host that does not say so.
   */
  sources?: boolean;
  /**
   * The jobs user, and whether its `gh` says it is signed out (#Q4256): a
   * read or write job is refused before it is queued then.
   */
  jobsUser?: string;
  ghSignedOut?: boolean;
}

/**
 * What core's Agent host service registers (#Q3985): the Agent hosts a
 * project may run its agent jobs on, its own and those lent to it. There is
 * no default one since #Q4223: a run names its host when there are several.
 */
export interface AgentHostDirectory {
  list(projectId: number): Promise<AgentHostRef[]>;
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
   * The Agent hosts a project may run its agent jobs on, each with the
   * agent CLIs it reports (#Q4223). Empty without one: the agent entries
   * hide, and an agent job refuses to start.
   */
  public async agentHosts(projectId: number): Promise<AgentHostRef[]> {
    return (await this.agents?.list(projectId)) ?? [];
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

  /**
   * One stream of a job's log, whole: empty without Ship.
   */
  public async text(
    jobId: string,
    stream: "stdout" | "stderr",
  ): Promise<string> {
    return (await this.queue?.text(jobId, stream)) ?? "";
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

  /**
   * An automation's jobs that are still queued or running (#Q4226): its
   * single-flight check. Empty without Ship.
   */
  public async activeForAutomation(
    automationId: string,
  ): Promise<HostJobSummary[]> {
    return (await this.queue?.activeForAutomation(automationId)) ?? [];
  }

  /**
   * How many jobs automations started since an instant (#Q4230). Zero
   * without Ship.
   */
  public async countAutomationJobs(
    filter: AutomationJobCount,
  ): Promise<number> {
    return (await this.queue?.countAutomationJobs(filter)) ?? 0;
  }

  /**
   * The jobs an automation started on these subjects (#Q4234), newest
   * first. Empty without Ship.
   */
  public async automationJobsOn(
    projectId: number,
    subjectType: string,
    subjectIds: string[],
  ): Promise<HostJobSummary[]> {
    if (!subjectIds.length) return [];
    return (
      (await this.queue?.automationJobsOn(
        projectId,
        subjectType,
        subjectIds,
      )) ?? []
    );
  }

  /**
   * What an automation's jobs were about (#Q4229), by subject id.
   */
  public async subjectsOfAutomation(
    automationId: string,
    subjectType: string,
  ): Promise<string[]> {
    return (
      (await this.queue?.subjectsOfAutomation(automationId, subjectType)) ?? []
    );
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
