import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ForbiddenError } from "alepha/server";

import type { AgentJobRequest } from "./AgentJobs.ts";
import {
  type AgentHostRef,
  HostJobs,
  type HostJobSummary,
} from "./HostJobs.ts";
import { JobKeyService } from "./JobKeyService.ts";

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
 * - the gate on outside text: an untrusted request never starts.
 *
 * Nothing of the agent's output is read. The job succeeds or fails by its
 * exit code; what the agent did is what it wrote to Lore.
 */
export class AgentJobService {
  /**
   * A job's time when the request names none.
   */
  public static readonly DEFAULT_TIMEOUT_SECONDS = 30 * 60;

  /**
   * The most time a request gets, whatever it asks.
   */
  public static readonly MAX_TIMEOUT_SECONDS = 2 * 3600;

  /**
   * The least, so a cold CLI has time to start.
   */
  public static readonly MIN_TIMEOUT_SECONDS = 60;

  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly port = $inject(HostJobs);
  protected readonly keys = $inject(JobKeyService);

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
    return this.port.start({
      projectId: request.projectId,
      hostId: host.id,
      kind: "agent",
      startedBy: request.startedBy,
      startedByJobId: parent,
      automationId: request.automationId,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      input: {
        ...(agent ? { agent } : {}),
        ...(request.model ? { model: request.model } : {}),
        workspace:
          request.workspace ??
          (request.questNumber === undefined
            ? "triage"
            : `q${request.questNumber}`),
        prompt: request.prompt,
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
        },
      },
    });
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
    run: { host?: string; agent?: string },
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
    if (agents && agents.length > 1) {
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
  public async choices(
    projectId: number,
  ): Promise<Array<{ host: string; agent?: string }>> {
    const hosts = await this.port.agentHosts(projectId);
    return hosts
      .filter((host) => host.status === "available")
      .flatMap((host) =>
        host.agents?.length
          ? host.agents.map((agent) => ({ host: host.slug, agent }))
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
   * The chain rule (#Q4229): a job whose chain holds an agent job starts no
   * agent job, with one hop open and no further. A build an automation
   * starts may follow a **triage** job that itself has no agent parent, so a
   * quest a triage filed is built once; a build job's output starts
   * nothing, and every other chain is refused.
   */
  public async chainAllows(
    parentId: string,
    request: Pick<AgentJobRequest, "build" | "automationId">,
  ): Promise<boolean> {
    if (!(await this.port.chainHolds(parentId, "agent"))) return true;
    if (!request.build || !request.automationId) return false;
    const parent = await this.port.get(parentId);
    if (
      parent?.kind !== "agent" ||
      !AgentJobService.TRIAGE_SUBJECTS.includes(parent.subjectType ?? "")
    ) {
      return false;
    }
    return (
      !parent.startedByJobId ||
      !(await this.port.chainHolds(parent.startedByJobId, "agent"))
    );
  }

  /**
   * The subjects of a triage job: one item, or the inbox.
   */
  public static readonly TRIAGE_SUBJECTS = ["feedback", "feedback-inbox"];

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
