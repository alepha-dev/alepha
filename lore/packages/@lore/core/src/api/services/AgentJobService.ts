import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ForbiddenError } from "alepha/server";

import type { AgentJobRequest } from "./AgentJobs.ts";
import { HostJobs, type HostJobSummary } from "./HostJobs.ts";
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
 *   cannot start its successor;
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
    const host = await this.port.agentHostFor(request.projectId);
    if (!host) {
      throw new ForbiddenError(
        "This project names no Agent host: pick one on its hosts settings page",
      );
    }
    // An agent the host does not report is refused before anything is
    // queued (#Q4220): Bay would fail the job at once, after a pull.
    if (request.agent && host.agents && !host.agents.includes(request.agent)) {
      throw new BadRequestError(
        `Host "${host.slug}" reports no ${request.agent} agent: it has ${host.agents.length ? host.agents.join(", ") : "none"}`,
      );
    }
    if (request.untrusted) {
      // Text from outside the team reaches no agent before a member trusted
      // it (#Q4216, #Q4233); the callers leave such items out, and this is
      // the floor under them.
      throw new ForbiddenError(
        "Untrusted input never reaches an agent: a member must trust it first",
      );
    }
    const parent = request.startedByJobId ?? (await this.callerJob());
    if (parent && (await this.port.chainHolds(parent, "agent"))) {
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
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      input: {
        ...(request.agent ? { agent: request.agent } : {}),
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
