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
 * - optionally **one quest**, **a set of feedback items**, **one epic** or
 *   **one error**, for the tools that name one. Any other tool the owner's rank allows is
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

  /**
   * The error tools an error pin holds to its error (#Q4471), by their
   * `error_id`. `error_list` stays project wide: it names none, and lists
   * what the key's owner may read anyway.
   */
  public static readonly ERROR_TOOLS = new Set([
    "error_get",
    "error_comment_add",
    "error_resolve",
    "error_forward",
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

  /**
   * The outside text no member trusted (#Q4287): Plan's, registered here,
   * since feedback and quests are its entities. Absent, nothing is hidden.
   */
  protected outsideText?: OutsideTextSource;

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
   * Registers Plan's reader of untrusted feedback and the quests born of it
   * (#Q4287).
   */
  public registerOutsideText(source: OutsideTextSource): void {
    this.outsideText = source;
  }

  /**
   * The job key the current MCP call authenticated with, or undefined for a
   * member's own session or API key.
   */
  public async current(): Promise<JobKey | undefined> {
    const request = this.alepha.store.get("alepha.http.request") as
      | { user?: UserAccountToken }
      | undefined;
    return this.scopeOf(request?.user);
  }

  /**
   * What a job key may not read in a project (#Q4287): the untrusted
   * feedback items no member trusted and the quests born of one nobody
   * confirmed, by number. Undefined for a member's own session or key, so a
   * read stays as it was for them. Every MCP read that carries their text
   * leaves them out with it, whatever the prompt asked.
   */
  public async hiddenFor(projectId: number): Promise<OutsideText | undefined> {
    if (!this.outsideText || !(await this.current())) return undefined;
    return this.outsideText.hidden(projectId);
  }

  /**
   * Whether one of `hidden`'s items is what a row names: its kind
   * (`quest`, `feedback`) and number, or a link to its page.
   */
  public static names(
    hidden: OutsideText,
    row: { kind?: string; number?: unknown; href?: string },
  ): boolean {
    const number = Number(row.number);
    if (row.kind === "quest" && hidden.quests.has(number)) return true;
    if (row.kind === "feedback" && hidden.feedback.has(number)) return true;
    const href = row.href ?? "";
    if (!href.includes(`/${hidden.slug}/`)) return false;
    const quest = /\/quests\/(\d+)/.exec(href);
    if (quest && hidden.quests.has(Number(quest[1]))) return true;
    const item = /feedback(?:=|\/)(\d+)/.exec(href);
    return !!item && hidden.feedback.has(Number(item[1]));
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
      errorId: scope.errorId,
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
   * a pinned quest, feedback item, epic or error the only one named.
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
      await this.checkOutsideText(key, name, args);
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
    const error = key.errorId ?? undefined;
    if (
      error !== undefined &&
      JobKeyService.ERROR_TOOLS.has(name) &&
      args.error_id !== error
    ) {
      throw new ForbiddenError(`This job key reaches error ${error} only`);
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
   * A tool naming an untrusted feedback item no member trusted, or a quest
   * born of one nobody confirmed, is refused under a job key, pinned or not
   * (#Q4287). The refusal names the item and what lets it through.
   */
  public async checkOutsideText(
    key: JobKey,
    name: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    if (!this.outsideText) return;
    const refusal = await this.outsideText.refuse(key.projectId, name, args);
    if (refusal) throw new ForbiddenError(refusal);
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

/**
 * Plan's reader of outside text (#Q4287): what a job key may not read in a
 * project, and the refusal of a call naming one of them.
 */
export interface OutsideTextSource {
  hidden(projectId: number): Promise<OutsideText>;
  refuse(
    projectId: number,
    name: string,
    args: Record<string, unknown>,
  ): Promise<string | undefined>;
}

/**
 * The numbers a job key may not read: feedback `shortId`s and quest
 * `shortId`s.
 */
export interface OutsideText {
  feedback: Set<number>;
  quests: Set<number>;
  /**
   * The project's URL slug, to read a link to one of them.
   */
  slug: string;
}
