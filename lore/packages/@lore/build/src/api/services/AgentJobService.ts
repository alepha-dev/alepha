import {
  type AgentJobRequest,
  AgentJobs,
  HostJobs,
  type HostJobSummary,
} from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $hook, $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { BadRequestError, ForbiddenError } from "alepha/server";

import {
  AGENT_BASE_EGRESS,
  AGENT_BUDGET_CEILING,
  AGENT_JOB_PROFILES,
  AGENT_MCP_SERVER,
  AGENT_PUSH_EGRESS,
} from "../schemas/agentJobProfiles.ts";
import { CodeRepositoryService } from "./CodeRepositoryService.ts";

/**
 * The agent job (#Q3986): Claude Code run with `claude -p` on the project's
 * Agent host, against a fresh clone of one of its Lore repositories, through
 * the host job foundation (`HostJobs`, Ship's queue).
 *
 * Lore's side, all here:
 * - the job's input: the rendered prompt, the repository and ref, one of the
 *   fixed profiles with its turn budget, timeout and tool lists, and the job
 *   key's scope (the profile's Lore tools, the repository, `lore/q<n>` for a
 *   push, the quest or feedback item it is about);
 * - the guard on chains: a job started by a job never starts another agent
 *   job of the same chain, so an agent's output cannot start its successor;
 * - the reader of the result: Claude Code's final `result` line kept on the
 *   job (text, cost, usage, turns), a usage limit turned into `paused` with
 *   its window, and an auth or limit failure answered by a recheck of the
 *   Agent host.
 *
 * Bay builds the command line from the spec; nothing here is an argument
 * list.
 */
export class AgentJobService {
  /**
   * How long a paused job waits when the limit's message names no window.
   */
  public static readonly DEFAULT_PAUSE_SECONDS = 3600;

  /**
   * Claude Code's usage-limit message, with the epoch seconds it lifts at
   * when it says so (`Claude AI usage limit reached|1763700000`).
   */
  public static readonly USAGE_LIMIT =
    /usage limit reached(?:\|(\d{9,11}))?|rate[_ ]limit|429 Too Many Requests/i;

  /**
   * An expired or refused credential, in Claude Code's or the API's words.
   */
  public static readonly AUTH_FAILURE =
    /invalid api key|authentication[_ ]error|oauth token (?:has )?expired|please run \/login|401 unauthorized|credit balance is too low/i;

  protected readonly log = $logger();
  protected readonly port = $inject(HostJobs);
  protected readonly repositories = $inject(CodeRepositoryService);
  protected readonly projects = $repository(projects);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly launcher = $inject(AgentJobs);

  constructor() {
    // Plan starts agent jobs through core's port (#Q3988).
    this.launcher.register((request) => this.start(request));
  }

  /**
   * Starts an agent job on the project's default Agent host. With
   * `untrusted` (#Q3987) it is refused on a host that runs jobs as a
   * process, and runs the `read` profile whatever was asked.
   */
  public async start(request: AgentJobRequest): Promise<HostJobSummary> {
    const host = await this.port.agentHostFor(request.projectId);
    if (!host) {
      throw new ForbiddenError(
        "This project names no Agent host: pick one on its hosts settings page",
      );
    }
    if (request.untrusted) {
      // The PoC gate: on a process runner the job has the jobs user's shell
      // on the host and the Claude credential in reach, so attacker text
      // never reaches one. A container runner lifts it.
      if (host.runner !== "container") {
        throw new ForbiddenError(
          `Untrusted input never reaches an agent on ${host.slug}, which runs jobs as a host process: a member must handle it`,
        );
      }
      // Whatever the caller or the agent decides: no push, no write but the
      // tools the read profile's key holds.
      request = { ...request, profile: "read", questNumber: undefined };
    }
    if (
      request.startedByJobId &&
      (await this.port.chainHolds(request.startedByJobId, "agent"))
    ) {
      throw new ForbiddenError(
        "An agent job's output cannot start another agent job of its chain",
      );
    }
    if (request.profile === "push" && request.questNumber === undefined) {
      throw new BadRequestError("A push job works on one quest");
    }
    const project = await this.projects.getOne({
      where: { id: { eq: request.projectId } },
    });
    const projectSlug = project.slug ?? String(project.id);
    const repository = request.repository
      ? await this.repositories.find(request.projectId, request.repository)
      : await this.defaultRepository(request.projectId, projectSlug);
    if (!repository) {
      throw new BadRequestError(
        "This project has no Lore repository for the agent to clone",
      );
    }
    const profile = AGENT_JOB_PROFILES[request.profile];
    const budget = this.budgetOf(profile, request.budget);
    const loreTools = request.tools.map(
      (tool) => `mcp__${AGENT_MCP_SERVER}__${tool}`,
    );
    return this.port.start({
      projectId: request.projectId,
      hostId: host.id,
      kind: "agent",
      startedBy: request.startedBy,
      startedByJobId: request.startedByJobId,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      input: {
        profile: request.profile,
        // A path: the spec pull puts it on the origin the machine asks on.
        repository: {
          cloneUrl: this.repositories.cloneUrl(
            projectSlug,
            repository.slug,
            "",
          ),
          ref: request.ref ?? repository.defaultBranch,
        },
        prompt: request.prompt,
        maxTurns: budget.maxTurns,
        timeoutSeconds: budget.timeoutSeconds,
        allowedTools: [...profile.allowedTools, ...loreTools],
        disallowedTools: profile.disallowedTools,
        ...(profile.permissionMode
          ? { permissionMode: profile.permissionMode }
          : {}),
        egress: [
          ...AGENT_BASE_EGRESS,
          ...(request.profile === "push"
            ? (project.agentEgressHosts ?? AGENT_PUSH_EGRESS)
            : []),
        ],
        key: {
          tools: request.tools,
          repositoryId: repository.id,
          ...(request.profile === "push" && request.questNumber !== undefined
            ? { writeRefPrefix: `lore/q${request.questNumber}` }
            : {}),
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
   * The turns and time a job runs under: the profile's, raised by a
   * request's budget (#Q4183) up to {@link AGENT_BUDGET_CEILING}, never
   * lowered below the profile's own.
   */
  protected budgetOf(
    profile: { maxTurns: number; timeoutSeconds: number },
    asked?: { maxTurns: number; timeoutSeconds: number },
  ): { maxTurns: number; timeoutSeconds: number } {
    if (!asked) return profile;
    const clamp = (value: number, low: number, high: number) =>
      Math.min(Math.max(Math.round(value), low), high);
    return {
      maxTurns: clamp(
        asked.maxTurns,
        profile.maxTurns,
        AGENT_BUDGET_CEILING.maxTurns,
      ),
      timeoutSeconds: clamp(
        asked.timeoutSeconds,
        profile.timeoutSeconds,
        AGENT_BUDGET_CEILING.timeoutSeconds,
      ),
    };
  }

  /**
   * The repository named like the project, else its only one.
   */
  protected async defaultRepository(projectId: number, projectSlug: string) {
    const named = await this.repositories.find(projectId, projectSlug);
    if (named) return named;
    const all = await this.repositories.list(projectId);
    return all.length === 1 ? all[0] : undefined;
  }

  /**
   * An agent job's end: its result kept, a usage limit paused, a credential
   * failure rechecked.
   */
  protected readonly onJobEnded = $hook({
    on: "host:job:ended",
    handler: async ({ job }) => {
      if (job.kind !== "agent") return;
      const output = await this.port.stdout(job.id);
      const result = this.resultOf(output);
      if (result) {
        await this.port.setResult(job.id, result);
      }
      const said = [
        typeof result?.result === "string" ? result.result : "",
        job.reason ?? "",
      ].join("\n");
      const limit = AgentJobService.USAGE_LIMIT.exec(said);
      if (job.status !== "succeeded" && limit) {
        const lifts = limit[1]
          ? Number(limit[1]) * 1000
          : this.dateTime.nowMillis() +
            AgentJobService.DEFAULT_PAUSE_SECONDS * 1000;
        await this.port.pause(
          job.id,
          new Date(lifts).toISOString(),
          "Paused by the provider's usage limit",
        );
      }
      if (
        job.status !== "succeeded" &&
        job.hostId &&
        (limit || AgentJobService.AUTH_FAILURE.test(said))
      ) {
        await this.port.recheckHost(job.hostId);
      }
    },
  });

  /**
   * Claude Code's final `result` line, as the job keeps it: the text (cut),
   * the cost and usage it reports, the turns, and whether it is an error.
   */
  public resultOf(output: string): Record<string, unknown> | undefined {
    let last: Record<string, unknown> | undefined;
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;
        if (event.type === "result") last = event;
      } catch {
        // A line cut by the log cap, or not JSON: skipped.
      }
    }
    if (!last) return undefined;
    return {
      subtype: last.subtype,
      isError: last.is_error === true,
      result:
        typeof last.result === "string"
          ? last.result.slice(0, 4000)
          : undefined,
      totalCostUsd: last.total_cost_usd,
      numTurns: last.num_turns,
      durationMs: last.duration_ms,
      usage: last.usage,
    };
  }
}
