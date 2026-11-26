import { randomUUID } from "node:crypto";

import {
  type AgentHostRef,
  type AgentJobRequest,
  AgentJobs,
  type AgentRunOption,
  type HostJobSummary,
  HostJobs,
  JobKeyService,
} from "@lore/core/api";
import {
  AGENT_JOB_MAX_TIMEOUT_SECONDS,
  AGENT_JOB_MIN_TIMEOUT_SECONDS,
  AGENT_JOB_TIMEOUT_SECONDS,
  type HostJobSource,
  jobRepositoryOf,
  projects,
} from "@lore/core/schemas";
import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ForbiddenError } from "alepha/server";

import { AgentRunPreamble } from "./AgentRunPreamble.ts";

/**
 * The agent job (#Q3986, light since #Q4222): a prompt, an agent CLI, a model
 * and a workspace, run on the project's Agent host through the host job
 * foundation (`HostJobs`, Ship's queue). Core's since #E171, so it depends on
 * no feature module and needs no repository.
 *
 * Lore's side, all here:
 * - the job's input: the rendered prompt, the agent and its model, the
 *   workspace, a timeout clamped to {@link MAX_TIMEOUT_SECONDS}, and the job
 *   key's pins (the quest, feedback items or epic it is about). The key
 *   itself is minted when the host pulls the spec, owned by whoever started
 *   the job, and reaches Lore's MCP only;
 * - the guard on chains: a job started with a job key records that key's
 *   job as its parent, and a chain never holds two agent jobs, so an agent
 *   cannot start its successor, with one hop open (#Q4229): a triage's
 *   quest built by an automation, once ({@link chainAllows});
 * - the gate on outside text: an untrusted request never starts;
 * - the job's source (#E173): none, read or write, its workspace and its
 *   branch, and the preamble that says where the code is, rendered once the
 *   source is settled ({@link sourceOf}).
 *
 * Nothing of the agent's output is read. The job succeeds or fails by its
 * exit code; what the agent did is what it wrote to Lore.
 */
export class AgentJobService {
  /**
   * A job's time when the request names none: every agent job's 4 h
   * (#Q4439).
   */
  public static readonly DEFAULT_TIMEOUT_SECONDS = AGENT_JOB_TIMEOUT_SECONDS;

  /**
   * The most time a request gets, whatever it asks.
   */
  public static readonly MAX_TIMEOUT_SECONDS = AGENT_JOB_MAX_TIMEOUT_SECONDS;

  /**
   * The least, so a cold CLI has time to start.
   */
  public static readonly MIN_TIMEOUT_SECONDS = AGENT_JOB_MIN_TIMEOUT_SECONDS;

  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly port = $inject(HostJobs);
  protected readonly keys = $inject(JobKeyService);
  protected readonly preamble = $inject(AgentRunPreamble);
  protected readonly projects = $repository(projects);
  protected readonly agentJobs = $inject(AgentJobs);

  constructor() {
    // The runner of core's port (#E175): Plan reaches it through
    // `AgentJobs`, never through this class.
    this.agentJobs.register(this);
  }

  /**
   * Starts an agent job on the project's Agent host.
   */
  public async start(request: AgentJobRequest): Promise<HostJobSummary> {
    const { host, agent } = await this.resolve(request.projectId, request);
    if (request.untrusted) {
      // Text from outside the team reaches no agent before a member trusted
      // it (#Q4216, #Q4233); the callers leave such items out, and this is
      // the floor under them.
      throw new ForbiddenError(
        "Untrusted input never reaches an agent: a member must trust it first",
      );
    }
    const parent = request.startedByJobId ?? (await this.callerJob());
    if (parent && !(await this.chainAllows(parent, request))) {
      throw new ForbiddenError(
        "An agent job's output cannot start another agent job of its chain",
      );
    }
    const repository = await this.repositoryOf(request.projectId);
    const source = this.sourceOf(request, repository !== undefined);
    if (source.mode !== "none") {
      if (!repository) {
        throw new BadRequestError(
          "A read or write job needs the project's repository on GitHub: set its Repository URL to https://github.com/<owner>/<name> in the project's settings",
        );
      }
      if (!host.sources) {
        throw new BadRequestError(
          `Host "${host.slug}" runs a Bay that does not prepare job sources: upgrade Bay on ${host.slug}`,
        );
      }
      // The mirror fetches through gh (#Q4256): the job would fail there.
      if (host.ghSignedOut) {
        throw new BadRequestError(
          `Host "${host.slug}" reports its jobs user's gh CLI signed out: sudo -iu ${host.jobsUser ?? "<jobs user>"} gh auth login`,
        );
      }
    }
    // A pull request's head read by an automation, or by a prompt a
    // trigger started, is never trusted: only a member's own run may skip
    // the author's check (#Q4251, #Q4275).
    if (
      request.record &&
      request.record.cause.kind !== "hand" &&
      source.ref?.startsWith("pull/") &&
      source.mode !== "none"
    ) {
      source.trust = "pr-author-writes";
    }
    // A write job not on one quest is named after itself (#Q4248); one on a
    // pull request works on its branch, which Bay asks GitHub for (#Q4251).
    const id = randomUUID();
    const jobName = `job-${id.slice(0, 8)}`;
    if (
      source.mode === "write" &&
      !source.branch &&
      !source.ref?.startsWith("pull/")
    ) {
      source.branch =
        this.oneQuest(request) === undefined
          ? `lore/${jobName}`
          : `lore/q${request.questNumber}`;
    }
    const workspace =
      request.workspace ??
      (request.questNumber !== undefined && this.oneQuest(request) !== undefined
        ? `q${request.questNumber}`
        : source.mode === "write"
          ? jobName
          : "triage");
    const prompt = this.preamble.place(
      request.prompt,
      this.preamble.render(source, repository),
    );
    return this.port.start({
      id,
      projectId: request.projectId,
      hostId: host.id,
      kind: "agent",
      startedBy: request.startedBy,
      startedByJobId: parent,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      ...(request.record
        ? {
            prompt: request.record.prompt,
            args: request.record.args,
            cause: request.record.cause,
            ...(request.record.promptHash
              ? { promptHash: request.record.promptHash }
              : {}),
          }
        : {}),
      input: {
        ...(agent ? { agent } : {}),
        ...(request.model ? { model: request.model } : {}),
        workspace,
        prompt,
        source,
        ...(request.output ? { output: request.output } : {}),
        ...(request.session
          ? { session: request.session }
          : request.record
            ? { session: { id: randomUUID() } }
            : {}),
        timeoutSeconds: this.timeoutOf(request.timeoutSeconds),
        key: {
          ...(request.questNumber === undefined
            ? {}
            : { questId: request.questNumber }),
          ...(request.feedbackNumber === undefined
            ? {}
            : { feedbackId: request.feedbackNumber }),
          ...(request.feedbackNumbers?.length
            ? { feedbackIds: request.feedbackNumbers }
            : {}),
          ...(request.epicNumber === undefined
            ? {}
            : { epicId: request.epicNumber }),
          ...(request.errorId === undefined
            ? {}
            : { errorId: request.errorId }),
        },
      },
    });
  }

  /**
   * The job's source (#E173, the epic's review items 2 and 4): what the
   * request asks, else its default (`write` for a quest's build, `read`
   * otherwise), every read at the default branch unless it names a ref. A
   * default on a project with no GitHub repository is `none`, where the run
   * works from Lore as before; a source the request asks for is kept, and
   * refused by {@link start} when the project cannot have it.
   */
  public sourceOf(
    request: Pick<AgentJobRequest, "source" | "defaultSource">,
    hasRepository: boolean,
  ): HostJobSource {
    if (request.source) {
      return {
        mode: request.source.mode,
        ...(request.source.ref ? { ref: request.source.ref } : {}),
        ...(request.source.branch && request.source.mode === "write"
          ? { branch: request.source.branch }
          : {}),
        ...(request.source.trust ? { trust: request.source.trust } : {}),
        ...(request.source.resume &&
        request.source.mode === "write" &&
        request.source.branch
          ? { resume: true }
          : {}),
      };
    }
    if (!hasRepository) return { mode: "none" };
    return { mode: request.defaultSource ?? "read" };
  }

  /**
   * The quest a job is on, when it is on one quest and nothing else: its
   * branch is `lore/q<n>` and its workspace `q<n>`.
   */
  protected oneQuest(request: AgentJobRequest): number | undefined {
    if (
      request.questNumber === undefined ||
      request.epicNumber !== undefined ||
      request.feedbackNumber !== undefined ||
      request.feedbackNumbers?.length
    ) {
      return undefined;
    }
    return request.questNumber;
  }

  /**
   * The project's repository as a job is prepared from it: on GitHub, or
   * undefined.
   */
  public async repositoryOf(projectId: number): Promise<string | undefined> {
    const project = await this.projects.findOne({
      where: { id: { eq: projectId } },
    });
    return jobRepositoryOf(project?.repositoryUrl);
  }

  /**
   * The host and agent a run uses (#Q4223, no default host): the one it
   * names, or the project's only Agent host; the agent it names, or the
   * host's only agent CLI. Several and none named is refused with the list
   * to pick from; an agent the host does not report is refused before
   * anything is queued (#Q4220). A host that reported no tools yet takes
   * the named agent, or Bay's default.
   */
  public async resolve(
    projectId: number,
    run: { host?: string; agent?: string; firstAgent?: boolean },
  ): Promise<{ host: AgentHostRef; agent?: string }> {
    const hosts = await this.port.agentHosts(projectId);
    if (!hosts.length) {
      throw new ForbiddenError(
        "This project has no Agent host: make one of its hosts an Agent host first",
      );
    }
    let host: AgentHostRef | undefined;
    if (run.host) {
      host = hosts.find((it) => it.slug === run.host || it.id === run.host);
      if (!host) {
        throw new BadRequestError(
          `No Agent host "${run.host}" in this project: it has ${hosts.map((it) => it.slug).join(", ")}`,
        );
      }
    } else if (hosts.length === 1) {
      host = hosts[0];
    } else {
      throw new BadRequestError(
        `This project has ${hosts.length} Agent hosts: name one of ${hosts.map((it) => it.slug).join(", ")}`,
      );
    }
    if (!host) throw new BadRequestError("No Agent host");
    const agents = host.agents;
    if (run.agent) {
      if (agents && !agents.includes(run.agent)) {
        throw new BadRequestError(
          `Host "${host.slug}" reports no ${run.agent} agent: it has ${agents.length ? agents.join(", ") : "none"}`,
        );
      }
      return { host, agent: run.agent };
    }
    // A prompt's run takes the host's first agent (#Q4275): the page, the
    // CLI and the MCP behave alike.
    if (agents && agents.length > 1 && !run.firstAgent) {
      throw new BadRequestError(
        `Host "${host.slug}" reports ${agents.length} agents: name one of ${agents.join(", ")}`,
      );
    }
    return { host, agent: agents?.[0] };
  }

  /**
   * What a run may pick from (#Q4223): each available Agent host of the
   * project with each agent it reports, or the host alone when it reported
   * none yet. The agent entries offer one click when there is one choice,
   * a small picker otherwise.
   */
  public async choices(projectId: number): Promise<AgentRunOption[]> {
    const hosts = await this.port.agentHosts(projectId);
    return hosts
      .filter((host) => host.status === "available")
      .flatMap((host) =>
        host.agents?.length
          ? host.agents.map((agent) => ({
              host: host.slug,
              agent,
              ...(host.signedIn?.[agent] === undefined
                ? {}
                : { signedIn: host.signedIn[agent] }),
            }))
          : [{ host: host.slug }],
      );
  }

  /**
   * The time a job runs under: what it asks, within
   * {@link MIN_TIMEOUT_SECONDS} and {@link MAX_TIMEOUT_SECONDS}.
   */
  public timeoutOf(asked?: number): number {
    if (asked === undefined) return AgentJobService.DEFAULT_TIMEOUT_SECONDS;
    return Math.min(
      Math.max(Math.round(asked), AgentJobService.MIN_TIMEOUT_SECONDS),
      AgentJobService.MAX_TIMEOUT_SECONDS,
    );
  }

  /**
   * The chain rule (#Q4277): a chain holds at most two agent jobs, whatever
   * started the first, a member by hand or a trigger. The second is always
   * started by a trigger (an event the first job's output raised), and its
   * own events start nothing. A job key never starts a job by hand: an
   * agent calling Lore to run a prompt is refused.
   */
  public async chainAllows(
    parentId: string,
    request: Pick<AgentJobRequest, "record">,
  ): Promise<boolean> {
    if (!(await this.port.chainHolds(parentId, "agent"))) return true;
    if (!request.record || request.record.cause.kind === "hand") return false;
    const parent = await this.port.get(parentId);
    if (parent?.kind !== "agent") return false;
    return (
      !parent.startedByJobId ||
      !(await this.port.chainHolds(parent.startedByJobId, "agent"))
    );
  }

  /**
   * The job whose key made the current request, if a job key made it: an
   * agent calling Lore's MCP to start a job is that job's child, whatever
   * the caller passed (#Q4222).
   */
  protected async callerJob(): Promise<string | undefined> {
    const request = this.alepha.store.get("alepha.http.request") as
      | { user?: UserAccountToken }
      | undefined;
    const key = await this.keys.scopeOf(request?.user);
    return key?.jobId;
  }
}
