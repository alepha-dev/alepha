import { $hook, $inject, Alepha } from "alepha";
import { ApiKeyService } from "alepha/api/keys";
import { users } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { ForbiddenError } from "alepha/server";

import { type JobKey, jobKeys } from "../entities/jobKeys.ts";
import { projects } from "../entities/projects.ts";
import {
  HostJobs,
  type HostJobKeyScope,
  type HostJobSummary,
} from "./HostJobs.ts";
import { McpProjectScope } from "./McpProjectScope.ts";

/**
 * Job keys (#Q3995): the one credential a host job holds, minted when its
 * machine pulls the spec, revoked when the job ends.
 *
 * A job key is a framework API key (`ak_lorejob_...`) owned by the member who
 * started the job, so their rank bounds it, plus a `job_keys` row of pins
 * checked here, server side, whatever the prompt asked for:
 *
 * - **where it may be used**: Lore's MCP and git's smart HTTP, nothing
 *   else. An `ak_lorejob_` credential on any other route is refused before it is
 *   resolved;
 * - **one project**: the MCP run is pinned to it (`McpProjectScope`), so a
 *   tool resolving any other project throws;
 * - **an allowlist of tools**, and optionally **one quest** and **one
 *   feedback item** for the tools that name one;
 * - **git**: one repository, and write only below one ref prefix, both
 *   enforced by Build's git access from {@link scopeOf}.
 *
 * Expires after the job's timeout plus {@link MARGIN_SECONDS}, and is
 * revoked on every terminal status, `paused` included.
 */
export class JobKeyService {
  /**
   * The prefix every job key's token carries: what the route guard reads
   * before any key is resolved. It begins with `ak`, the prefix the
   * framework's key resolver reads, and fits the key's 10-character
   * `tokenPrefix` column.
   */
  public static readonly PREFIX = "ak_lorejob";

  /**
   * What a key outlives its job's timeout by: the clone, the spec pull and
   * a final MCP call after the deadline.
   */
  public static readonly MARGIN_SECONDS = 900;

  /**
   * The tools a pinned quest constrains, and those it leaves to the project
   * pin: a list or a create names no quest.
   */
  public static readonly UNPINNED_TOOLS = new Set([
    "quest_list",
    "quest_create",
    "quest_tags",
    "feedback_list",
  ]);

  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly rows = $repository(jobKeys);
  protected readonly projects = $repository(projects);
  protected readonly users = $repository(users);
  protected readonly apiKeys = $inject(ApiKeyService);
  protected readonly port = $inject(HostJobs);
  protected readonly mcp = $inject(McpProjectScope);
  protected readonly dateTime = $inject(DateTimeProvider);

  constructor() {
    this.port.registerKeyIssuer({
      mint: (job, scope) => this.mint(job, scope),
      revoke: (jobId) => this.revoke(jobId),
    });
  }

  /**
   * Mints a key for a job and answers its token, once. A second mint for
   * the same job (a redelivered spec pull) revokes the first.
   */
  public async mint(
    job: HostJobSummary,
    scope: HostJobKeyScope,
  ): Promise<string> {
    await this.revoke(job.id);
    const userId = job.startedBy ?? (await this.ownerOf(job.projectId));
    const owner = await this.users.findOne({ where: { id: { eq: userId } } });
    const roles = (owner as { roles?: string[] } | undefined)?.roles ?? [
      "user",
    ];
    const expiresAt = new Date(
      this.dateTime.nowMillis() +
        (job.input.timeoutSeconds + JobKeyService.MARGIN_SECONDS) * 1000,
    );
    const { apiKey, token } = await this.apiKeys.create({
      userId,
      name: `job ${job.id}`,
      description: `Host job ${job.id} (${job.kind}, ${job.input.profile})`,
      roles,
      expiresAt,
      prefix: JobKeyService.PREFIX,
    });
    await this.rows.create({
      apiKeyId: apiKey.id,
      jobId: job.id,
      projectId: job.projectId,
      userId,
      tools: scope.tools,
      questNumber: scope.questId,
      feedbackNumber: scope.feedbackId,
      feedbackNumbers: scope.feedbackIds,
      repositoryId: scope.repositoryId,
      writeRefPrefix: scope.writeRefPrefix,
      expiresAt: expiresAt.toISOString(),
    });
    return token;
  }

  /**
   * Revokes every live key of a job.
   */
  public async revoke(jobId: string): Promise<void> {
    const live = await this.rows.findMany({
      where: { jobId: { eq: jobId }, revokedAt: { isNull: true } },
    });
    for (const row of live) {
      await this.apiKeys.revoke(row.apiKeyId, row.userId).catch((error) => {
        this.log.warn("A job key's api key could not be revoked", {
          jobId,
          error,
        });
      });
      await this.rows.updateById(row.id, {
        revokedAt: new Date(this.dateTime.nowMillis()).toISOString(),
      });
    }
  }

  /**
   * The pins of the job key a caller authenticated with, or undefined when
   * the caller holds no job key. A revoked or expired pin row is answered
   * too: the api key behind it is refused already, and a caller holding one
   * is still a job key, never a member.
   */
  public async scopeOf(
    user: UserAccountToken | undefined,
  ): Promise<JobKey | undefined> {
    const credential = (user as { credential?: { type?: string; id?: string } })
      ?.credential;
    if (credential?.type !== "api-key" || !credential.id) {
      return undefined;
    }
    return this.rows.findOne({ where: { apiKeyId: { eq: credential.id } } });
  }

  /**
   * A job key is for MCP and git, nothing else: refused on any other route
   * before it is even resolved, by its token's prefix.
   */
  protected readonly onRequest = $hook({
    on: "server:request:before",
    priority: "first",
    handler: ({ request }) => {
      const token = this.tokenOf(
        (request.headers as Record<string, string | undefined>).authorization,
      );
      if (!token?.startsWith(`${JobKeyService.PREFIX}_`)) {
        return;
      }
      const path = request.url.pathname;
      if (path === "/mcp" || path.startsWith("/mcp/") || this.isGit(path)) {
        return;
      }
      throw new ForbiddenError("A job key reaches Lore's MCP and git only");
    },
  });

  /**
   * Every MCP call made with a job key: its tool on the allowlist, the run
   * pinned to the key's project, a pinned quest or feedback item the only one
   * named.
   */
  protected readonly onToolCall = $hook({
    on: "mcp:tool:call:begin",
    handler: async ({ name, args }) => {
      const request = this.alepha.store.get("alepha.http.request") as
        | { user?: UserAccountToken }
        | undefined;
      const key = await this.scopeOf(request?.user);
      if (!key) return;
      this.check(key, name, args);
      this.mcp.pin(key.projectId);
    },
  });

  /**
   * Refuses a call a key does not allow. Public for the specs.
   */
  public check(key: JobKey, name: string, args: Record<string, unknown>) {
    if (key.revokedAt) {
      throw new ForbiddenError("This job key is revoked");
    }
    if (!key.tools.includes(name)) {
      throw new ForbiddenError(`This job key does not reach the tool ${name}`);
    }
    const named = this.numberOf(args);
    if (
      key.questNumber !== undefined &&
      key.questNumber !== null &&
      name.startsWith("quest_") &&
      !JobKeyService.UNPINNED_TOOLS.has(name) &&
      named !== key.questNumber
    ) {
      throw new ForbiddenError(
        `This job key reaches quest ${key.questNumber} only`,
      );
    }
    const pinned = this.feedbackPins(key);
    if (
      pinned &&
      name.startsWith("feedback_") &&
      !JobKeyService.UNPINNED_TOOLS.has(name) &&
      (named === undefined || !pinned.includes(named))
    ) {
      throw new ForbiddenError(this.feedbackRefusal(pinned));
    }
    // A quest links a feedback item by `feedback_shortId`: a pinned key
    // links only its own, or a triage could accept and file against an
    // item it was never given.
    const linked = args.feedback_shortId;
    if (
      pinned &&
      typeof linked === "number" &&
      linked !== 0 &&
      !pinned.includes(linked)
    ) {
      throw new ForbiddenError(this.feedbackRefusal(pinned));
    }
  }

  /**
   * The feedback items a key is pinned to, or undefined when it is not.
   */
  protected feedbackPins(key: JobKey): number[] | undefined {
    if (key.feedbackNumbers?.length) return key.feedbackNumbers;
    if (key.feedbackNumber !== undefined && key.feedbackNumber !== null) {
      return [key.feedbackNumber];
    }
    return undefined;
  }

  protected feedbackRefusal(pinned: number[]): string {
    return pinned.length === 1
      ? `This job key reaches feedback ${pinned[0]} only`
      : `This job key reaches feedback ${pinned.join(", ")} only`;
  }

  /**
   * Whether a ref a push updates is one a job key may write.
   */
  public mayWriteRef(key: JobKey, ref: string): boolean {
    if (!key.writeRefPrefix) return false;
    const base = `refs/heads/${key.writeRefPrefix}`;
    return ref === base || ref.startsWith(`${base}/`);
  }

  /**
   * The per-project number a call names, by the parameter MCP tools use.
   */
  protected numberOf(args: Record<string, unknown>): number | undefined {
    const value = args.shortId ?? args.number;
    return typeof value === "number" ? value : undefined;
  }

  protected isGit(path: string): boolean {
    return /\.git(\/|$)/.test(path);
  }

  protected tokenOf(authorization?: string): string | undefined {
    if (!authorization) return undefined;
    const bearer = /^Bearer\s+(\S+)$/i.exec(authorization);
    if (bearer?.[1]) return bearer[1];
    const basic = /^Basic\s+(\S+)$/i.exec(authorization);
    if (!basic?.[1]) return undefined;
    try {
      const decoded = atob(basic[1]);
      return decoded.slice(decoded.indexOf(":") + 1);
    } catch {
      return undefined;
    }
  }

  protected async ownerOf(projectId: number): Promise<string> {
    const project = await this.projects.getOne({
      where: { id: { eq: projectId } },
    });
    return project.createdBy;
  }
}
