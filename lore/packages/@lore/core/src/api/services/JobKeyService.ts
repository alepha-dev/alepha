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
 * - **where it may be used**: Lore's MCP, nothing else (#Q4222). An
 *   `ak_lorejob_` credential on any other route, `/api` and git included, is
 *   refused before it is resolved. Bay hands it to the agent in its MCP
 *   configuration only;
 * - **one project**: the MCP run is pinned to it (`McpProjectScope`), so a
 *   tool resolving any other project throws;
 * - optionally **one quest**, **a set of feedback items** or **one epic**,
 *   for the tools that name one. Any other tool the owner's rank allows is
 *   open, within the project: there is no tool allowlist since #Q4222.
 *
 * Expires after the job's timeout plus {@link MARGIN_SECONDS}, and is
 * revoked on every terminal status.
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
   * What a key outlives its job's timeout by: the spec pull and a final MCP
   * call after the deadline.
   */
  public static readonly MARGIN_SECONDS = 900;

  /**
   * The tools a pinned quest constrains, and those it leaves to the project
   * pin: a list or a create names no quest.
   */
  /**
   * The quest tools an epic pin holds to the epic's own quests (#Q4214).
   * `quest_list` stays project wide: the review reads the epic's quests
   * with it, and a list writes nothing.
   */
  public static readonly EPIC_QUEST_TOOLS = new Set([
    "quest_get",
    "quest_update",
    "quest_objective_set",
  ]);

  /**
   * The creates an epic pin files under the epic, by `epic_number`.
   */
  public static readonly EPIC_CREATE_TOOLS = new Set([
    "quest_create",
    "folio_create",
  ]);

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

  /**
   * Whether a quest belongs to an epic: Plan's, registered here, since the
   * quests are its entity. Absent, an epic pin refuses every quest tool it
   * constrains.
   */
  protected epicMembership?: EpicMembership;

  constructor() {
    this.port.registerKeyIssuer({
      mint: (job, scope) => this.mint(job, scope),
      revoke: (jobId) => this.revoke(jobId),
    });
  }

  /**
   * Registers Plan's quest-in-epic lookup (#Q4214).
   */
  public registerEpicMembership(lookup: EpicMembership): void {
    this.epicMembership = lookup;
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
      description: `Host job ${job.id} (${job.kind}${job.input.agent ? `, ${job.input.agent}` : ""})`,
      roles,
      expiresAt,
      prefix: JobKeyService.PREFIX,
    });
    await this.rows.create({
      apiKeyId: apiKey.id,
      jobId: job.id,
      projectId: job.projectId,
      userId,
      questNumber: scope.questId,
      feedbackNumber: scope.feedbackId,
      feedbackNumbers: scope.feedbackIds,
      epicNumber: scope.epicId,
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
   * A job key is for MCP, nothing else: refused on any other route, `/api`
   * and git included, before it is even resolved, by its token's prefix.
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
      if (path === "/mcp" || path.startsWith("/mcp/")) {
        return;
      }
      throw new ForbiddenError("A job key reaches Lore's MCP only");
    },
  });

  /**
   * Every MCP call made with a job key: the run pinned to the key's project,
   * a pinned quest, feedback item or epic the only one named.
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
      await this.checkEpicQuest(key, name, args);
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
    const epic = key.epicNumber ?? undefined;
    if (epic !== undefined) {
      if (name.startsWith("epic_") && named !== epic) {
        throw new ForbiddenError(`This job key reaches epic ${epic} only`);
      }
      if (
        JobKeyService.EPIC_CREATE_TOOLS.has(name) &&
        args.epic_number !== epic
      ) {
        throw new ForbiddenError(
          `This job key files under epic ${epic} only: pass epic_number ${epic}`,
        );
      }
      // A quest of the epic stays in it: moving it out would take it past
      // the pin.
      if (
        name === "quest_update" &&
        args.epic_number !== undefined &&
        args.epic_number !== epic
      ) {
        throw new ForbiddenError(
          `This job key keeps quests in epic ${epic}: no epic_number but ${epic}`,
        );
      }
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
   * An epic pin's quest writes and reads reach the epic's own quests only
   * (#Q4214): a lookup, since a call names the quest and not its epic. A
   * quest the review filed under the epic a moment ago passes, since it is
   * read at the call. Public for the specs.
   */
  public async checkEpicQuest(
    key: JobKey,
    name: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const epic = key.epicNumber ?? undefined;
    if (epic === undefined || !JobKeyService.EPIC_QUEST_TOOLS.has(name)) {
      return;
    }
    const quest = {
      shortId: typeof args.shortId === "number" ? args.shortId : undefined,
      id: typeof args.id === "number" ? args.id : undefined,
    };
    const inEpic =
      (quest.shortId !== undefined || quest.id !== undefined) &&
      this.epicMembership !== undefined &&
      (await this.epicMembership(key.projectId, epic, quest));
    if (!inEpic) {
      throw new ForbiddenError(
        `This job key reaches the quests of epic ${epic} only`,
      );
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
   * The per-project number a call names, by the parameter MCP tools use.
   */
  protected numberOf(args: Record<string, unknown>): number | undefined {
    const value = args.shortId ?? args.number;
    return typeof value === "number" ? value : undefined;
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

/**
 * Whether a quest, by its per-project number or its global id, is filed
 * under an epic of a project, by the epic's number.
 */
export type EpicMembership = (
  projectId: number,
  epicNumber: number,
  quest: { shortId?: number; id?: number },
) => Promise<boolean>;
