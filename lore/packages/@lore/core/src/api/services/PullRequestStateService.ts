import { $hook, $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DbConflictError } from "alepha/orm";
import { ConflictError } from "alepha/server";

import type { ProjectRepository } from "../entities/projectRepositories.ts";
import { type PullRequestRow, pullRequests } from "../entities/pullRequests.ts";
import type { PullRequestState } from "../schemas/pullRequestStateSchema.ts";
import { GitHubClient } from "./GitHubClient.ts";
import { GitHubText } from "./GitHubText.ts";
import { GitHubTokenService } from "./GitHubTokenService.ts";
import {
  type GitHubWebhookContext,
  GitHubWebhookHandlers,
} from "./GitHubWebhookHandlers.ts";
import { ProjectRepositoryService } from "./ProjectRepositoryService.ts";
import { type SourceEvent, SourceRepository } from "./SourceRepository.ts";

/**
 * What changed on a pull request with one delivery (#Q4367, #Q4368): the row
 * after, the row before (absent for a pull request first seen), and the
 * delivery's event and action, for the listeners that attach it to quests
 * and raise the project events.
 */
export interface PullRequestChange {
  row: PullRequestRow;
  before?: PullRequestRow;
  event: string;
  action?: string;
  connection: ProjectRepository;
  /**
   * The pull request's body, capped: read for `#Q12`, never kept.
   */
  body?: string;
  /**
   * A backfill at connect (#Q4367): attach, raise nothing (the epic review's
   * answer to item 26).
   */
  silent?: boolean;
}

/**
 * One pull request transition, for the resolver that turns it into a
 * project event (#Q4368).
 */
export interface PullRequestTransition {
  before?: PullRequestRow;
  row: PullRequestRow;
  connection: ProjectRepository;
  action?: string;
  actorId?: string;
}

/**
 * A push to a connected repository, for the commit trail (#Q4367).
 */
export interface PushChange {
  connection: ProjectRepository;
  ref: string;
  commits: Array<{ sha: string; message: string }>;
}

/**
 * A workflow run that ended, for `workflow_run.failed` (#Q4368).
 */
export interface WorkflowRunChange {
  connection: ProjectRepository;
  id: number;
  name: string;
  conclusion: string;
  branch: string;
  url: string;
  headSha: string;
}

/**
 * Pull requests' state from GitHub's deliveries (#Q4367, epic #E177).
 *
 * Registers core's handlers of `pull_request`, `pull_request_review`,
 * `check_suite`, `check_run`, `status`, `workflow_run` and `push`, keeps the
 * `pull_requests` rows, and tells the listeners a package registers
 * ({@link onPullRequest}, {@link onPush}, {@link onWorkflowRun}) what
 * changed: Plan attaches pull requests and commits to quests and raises the
 * project events, without core reading a Plan table.
 *
 * ## The checks rollup
 *
 * For the head sha, from the completed check suites and the latest commit
 * status per context: `failing` if any concluded `failure`, `timed_out`,
 * `cancelled` or `action_required` (or a status `failure`/`error`),
 * `pending` while any is queued or in progress, `passing` when at least one
 * passed, `none` with nothing. A new head sha resets it to `pending`.
 *
 * Every handler is idempotent: a delivery handled twice writes the same row,
 * and a listener sees `before` equal to `row`.
 */
export class PullRequestStateService {
  public static readonly FAILING = [
    "failure",
    "timed_out",
    "cancelled",
    "action_required",
  ];

  protected readonly rows = $repository(pullRequests);
  protected readonly sources = $inject(SourceRepository.of(pullRequests));
  protected readonly handlers = $inject(GitHubWebhookHandlers);
  protected readonly text = $inject(GitHubText);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly repositories = $inject(ProjectRepositoryService);
  protected readonly client = $inject(GitHubClient);
  protected readonly tokens = $inject(GitHubTokenService);
  protected readonly permissions = new Map<
    string,
    { permission: string; until: number }
  >();
  protected readonly pullRequestListeners: Array<
    (change: PullRequestChange) => Promise<void>
  > = [];
  protected readonly pushListeners: Array<
    (change: PushChange) => Promise<void>
  > = [];
  protected readonly workflowListeners: Array<
    (change: WorkflowRunChange) => Promise<void>
  > = [];

  onPullRequest(listener: (change: PullRequestChange) => Promise<void>): void {
    this.pullRequestListeners.push(listener);
  }

  onPush(listener: (change: PushChange) => Promise<void>): void {
    this.pushListeners.push(listener);
  }

  onWorkflowRun(listener: (change: WorkflowRunChange) => Promise<void>): void {
    this.workflowListeners.push(listener);
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      this.handlers.register("pull_request", (context) =>
        this.pullRequest(context),
      );
      this.handlers.register("pull_request_review", (context) =>
        this.review(context),
      );
      this.handlers.register("check_suite", (context) =>
        this.checkSuite(context),
      );
      this.handlers.register("check_run", (context) => this.checkRun(context));
      this.handlers.register("status", (context) => this.status(context));
      this.handlers.register("workflow_run", (context) =>
        this.workflowRun(context),
      );
      this.handlers.register("push", (context) => this.push(context));
      this.repositories.onConnected((row) => this.backfill(row));
    },
  });

  // ---- reads ------------------------------------------------------------

  /**
   * The rows behind a list of recorded URLs, for the project's repository
   * now or under a name it had before a rename. Anything else answers
   * nothing: a bare record stays bare.
   */
  async statesFor(
    projectId: number,
    urls: string[],
  ): Promise<PullRequestState[]> {
    // No GitHub pull request URL, no read: most quests record none.
    const parsed = urls.slice(0, 50).flatMap((url) => {
      const match =
        /^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i.exec(
          url.trim(),
        );
      return match ? [{ url, repo: match[1], number: Number(match[2]) }] : [];
    });
    if (parsed.length === 0) return [];
    const row = await this.repositories.latestOf(projectId);
    if (!row) return [];
    const wanted = new Map<number, string>();
    for (const it of parsed) {
      if (this.repositories.names(row, it.repo)) wanted.set(it.number, it.url);
    }
    if (wanted.size === 0) return [];
    const rows = await this.rows.findMany({
      where: {
        repositoryId: { eq: row.repositoryId },
        number: { inArray: [...wanted.keys()] },
      },
    });
    return rows.map((it) => this.stateOf(it, wanted.get(it.number) ?? it.url));
  }

  /**
   * A row as the readers show it.
   */
  stateOf(row: PullRequestRow, url = row.url): PullRequestState {
    return {
      url,
      number: row.number,
      title: row.title,
      state: row.state,
      checks: row.checks,
      review: row.review,
      headRef: row.headRef,
      baseRef: row.baseRef,
      outside: this.outside(row),
      ...(row.queued !== undefined ? { queued: row.queued } : {}),
      ...(row.authorLogin ? { authorLogin: row.authorLogin } : {}),
      ...(row.mergeableState ? { mergeableState: row.mergeableState } : {}),
      ...(row.failingChecks?.length
        ? { failingChecks: row.failingChecks }
        : {}),
      ...(row.mergedAt ? { mergedAt: row.mergedAt } : {}),
      ...(row.trustedAt ? { trustedAt: row.trustedAt } : {}),
      ...(row.authorPermission
        ? { authorPermission: row.authorPermission }
        : {}),
    };
  }

  /**
   * From outside the team (#Q4368): Bay's rule, an author without write,
   * maintain or admin on the repository, and no member's trust. The App's
   * own bot reads as `app`. A permission not read yet (GitHub refused or
   * failed) is outside: the rule fails closed, and the next delivery reads
   * it again.
   */
  outside(row: PullRequestRow): boolean {
    if (row.trustedAt) return false;
    if (!row.authorPermission) return true;
    return !["admin", "maintain", "write", "app"].includes(
      row.authorPermission,
    );
  }

  /**
   * Reads a connected repository's open pull requests and the ones merged
   * in the last 30 days, once, at connect (#Q4367): rows and the trail,
   * with no event.
   */
  async backfill(connection: ProjectRepository): Promise<number> {
    const token = await this.repositories.readToken(connection);
    const repo = { owner: connection.owner, name: connection.name };
    const open = await this.client.listPullRequests(
      token,
      repo,
      { state: "open" },
      100,
    );
    const closed = await this.client.listPullRequests(
      token,
      repo,
      { state: "closed", sort: "updated", direction: "desc" },
      100,
    );
    const since = this.dateTime.nowMillis() - 30 * 24 * 3_600_000;
    const merged = closed.filter((pr) => {
      const at = Date.parse(String(pr?.merged_at ?? ""));
      return Number.isFinite(at) && at >= since;
    });
    let count = 0;
    for (const pr of [...open, ...merged]) {
      const data = this.text.object(pr);
      if (!data) continue;
      if (
        await this.upsertFrom(connection, data, {
          event: "pull_request",
          action: "backfill",
          silent: true,
        })
      ) {
        count++;
      }
    }
    return count;
  }

  async byNumber(
    repositoryId: number,
    number: number,
  ): Promise<PullRequestRow | undefined> {
    const [row] = await this.rows.findMany({
      where: {
        repositoryId: { eq: repositoryId },
        number: { eq: number },
      },
      limit: 1,
    });
    return row;
  }

  async ofProject(
    projectId: number,
    where: { numbers?: number[]; headRefs?: string[] } = {},
  ): Promise<PullRequestRow[]> {
    if (where.numbers && where.numbers.length === 0) return [];
    if (where.headRefs && where.headRefs.length === 0) return [];
    return await this.rows.findMany({
      where: {
        projectId: { eq: projectId },
        ...(where.numbers ? { number: { inArray: where.numbers } } : {}),
        ...(where.headRefs ? { headRef: { inArray: where.headRefs } } : {}),
      },
      limit: 200,
    });
  }

  /**
   * A member trusts a pull request from outside the team (#Q4368): stored on
   * the row, with `pull_request.trusted` in the same batch, once.
   */
  async trust(row: PullRequestRow, userId: string): Promise<PullRequestRow> {
    if (row.trustedAt) return row;
    const connection = await this.repositories.byRepositoryId(row.repositoryId);
    if (!connection) {
      return await this.rows.updateById(row.id, {
        trustedBy: userId,
        trustedAt: this.dateTime.nowISOString(),
      });
    }
    return await this.write(
      connection,
      row,
      { trustedBy: userId, trustedAt: this.dateTime.nowISOString() },
      { action: "trusted", actorId: userId },
    );
  }

  async setAuthorPermission(
    row: PullRequestRow,
    permission: string,
  ): Promise<PullRequestRow> {
    return await this.rows.updateById(row.id, {
      authorPermission: permission.slice(0, 20),
    });
  }

  /**
   * Writes a pull request from its GitHub object, as a delivery or the
   * backfill carries it, and tells the listeners.
   */
  async upsertFrom(
    connection: ProjectRepository,
    data: Record<string, unknown>,
    meta: { event: string; action?: string; silent?: boolean },
  ): Promise<PullRequestRow | undefined> {
    const number = this.text.integer(data.number);
    const githubId = this.text.integer(data.id);
    if (number === undefined || githubId === undefined) return undefined;
    const head = this.text.object(data.head);
    const base = this.text.object(data.base);
    const user = this.text.object(data.user);
    const headSha = this.text.text(head?.sha, 64) ?? "";
    const before = await this.byNumber(connection.repositoryId, number);
    const merged = Boolean(data.merged) || Boolean(data.merged_at);
    const state: PullRequestRow["state"] =
      data.state === "closed"
        ? merged
          ? "merged"
          : "closed"
        : data.draft === true
          ? "draft"
          : "open";
    const newHead = before !== undefined && before.headSha !== headSha;
    const mergeable = this.text.text(data.mergeable_state, 20);
    const fields = {
      projectId: connection.projectId,
      repositoryId: connection.repositoryId,
      repository: `${connection.owner}/${connection.name}`,
      githubId,
      number,
      title: this.text.text(data.title, 500) ?? `#${number}`,
      url:
        this.text.text(data.html_url, 500) ??
        `https://github.com/${connection.owner}/${connection.name}/pull/${number}`,
      ...(this.text.text(user?.login, 100)
        ? { authorLogin: this.text.text(user?.login, 100) }
        : {}),
      ...(this.text.integer(user?.id) !== undefined
        ? { authorGithubId: this.text.integer(user?.id) }
        : {}),
      // A fork's branch is `owner:branch`, GitHub's own label for it: a
      // fork naming its branch `lore/q12` or `lore/job-<id>` must not pass
      // for the repository's, which attaches quests and jobs by name.
      headRef: this.headRefOf(connection, head),
      baseRef: this.text.text(base?.ref, 255) ?? "",
      headSha,
      state,
      ...(meta.action === "enqueued" ? { queued: true } : {}),
      ...(meta.action === "dequeued" || state !== "open"
        ? { queued: false }
        : {}),
      ...(mergeable && mergeable !== "unknown"
        ? { mergeableState: mergeable }
        : {}),
      ...(this.text.text(data.merged_at, 40)
        ? { mergedAt: this.text.text(data.merged_at, 40) }
        : {}),
      ...(this.text.text(data.closed_at, 40)
        ? { closedAt: this.text.text(data.closed_at, 40) }
        : {}),
      ...(this.text.text(data.updated_at, 40)
        ? { githubUpdatedAt: this.text.text(data.updated_at, 40) }
        : {}),
    };
    // The author's permission, read until it is known (#Q4368): an author
    // outside the team waits for a member's trust. A backfilled row reads
    // it too, so an old outside pull request is not taken for the team's.
    const authorPermission = before?.authorPermission
      ? undefined
      : await this.permissionOf(connection, fields.authorLogin);
    const row = await this.write(
      connection,
      before,
      before
        ? {
            ...fields,
            ...(newHead
              ? {
                  checks: "pending" as const,
                  suites: {},
                  statuses: {},
                  failingChecks: [],
                }
              : {}),
            ...(meta.action === "review_requested" && before.review === "none"
              ? { review: "requested" as const }
              : {}),
            ...(authorPermission ? { authorPermission } : {}),
          }
        : {
            ...fields,
            checks: "pending" as const,
            review:
              meta.action === "review_requested"
                ? ("requested" as const)
                : ("none" as const),
            ...(authorPermission ? { authorPermission } : {}),
          },
      meta,
    );
    await this.notify({
      row,
      ...(before ? { before } : {}),
      event: meta.event,
      ...(meta.action ? { action: meta.action } : {}),
      connection,
      ...(this.text.text(data.body, 65_536)
        ? { body: this.text.text(data.body, 65_536) }
        : {}),
      ...(meta.silent ? { silent: true } : {}),
    });
    return row;
  }

  /**
   * The rollup of a head's suites and statuses.
   */
  rollup(
    suites: Record<string, string>,
    statuses: Record<string, string>,
  ): PullRequestRow["checks"] {
    const suiteValues = Object.values(suites);
    const statusValues = Object.values(statuses);
    if (suiteValues.length === 0 && statusValues.length === 0) return "none";
    const failing =
      suiteValues.some((it) =>
        PullRequestStateService.FAILING.includes(it.split(":")[1] ?? ""),
      ) || statusValues.some((it) => it === "failure" || it === "error");
    if (failing) return "failing";
    const pending =
      suiteValues.some((it) => it.split(":")[0] !== "completed") ||
      statusValues.some((it) => it === "pending");
    return pending ? "pending" : "passing";
  }

  /**
   * Decides the project event a transition raises (#Q4368): Plan registers
   * it with its event definitions. Absent, rows are written with no event.
   */
  onTransition(
    resolver: (
      transition: PullRequestTransition,
    ) => Promise<SourceEvent | undefined>,
  ): void {
    this.transitions = resolver;
  }

  protected transitions?: (
    transition: PullRequestTransition,
  ) => Promise<SourceEvent | undefined>;

  /**
   * Writes a row, and the event its transition raises in the same guarded
   * batch (`SourceRepository`): the guard is the state the transition read,
   * so a redelivered or repeated delivery writes the state and emits
   * nothing.
   */
  protected async write(
    connection: ProjectRepository,
    before: PullRequestRow | undefined,
    data: Partial<PullRequestRow>,
    meta: { action?: string; silent?: boolean; actorId?: string },
  ): Promise<PullRequestRow> {
    const next = { ...before, ...data } as PullRequestRow;
    const event =
      !meta.silent && this.transitions
        ? await this.transitions({
            before,
            row: next,
            connection,
            ...(meta.action ? { action: meta.action } : {}),
            ...(meta.actorId ? { actorId: meta.actorId } : {}),
          })
        : undefined;
    if (!before) {
      const insert = { id: crypto.randomUUID(), ...data } as PullRequestRow;
      if (!event) {
        try {
          return await this.rows.create(insert);
        } catch (error) {
          if (!(error instanceof DbConflictError)) throw error;
          const raced = await this.byNumber(next.repositoryId, next.number);
          if (!raced) throw error;
          return await this.rows.updateById(raced.id, data);
        }
      }
      try {
        return await this.sources.sourceCreate(
          insert,
          { repositoryId: next.repositoryId, number: next.number },
          event,
        );
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
        const raced = await this.byNumber(next.repositoryId, next.number);
        if (!raced) throw error;
        return await this.rows.updateById(raced.id, data);
      }
    }
    if (!event) return await this.rows.updateById(before.id, data);
    try {
      return await this.sources.sourceUpdate(
        {
          id: before.id,
          state: before.state,
          checks: before.checks,
          review: before.review,
          ...(meta.action === "trusted" ? { trustedAt: { isNull: true } } : {}),
        },
        data,
        event,
      );
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      // Another delivery recorded this transition already: keep the state,
      // raise nothing.
      return await this.rows.updateById(before.id, data);
    }
  }

  protected headRefOf(
    connection: ProjectRepository,
    head: Record<string, unknown> | undefined,
  ): string {
    const ref = this.text.text(head?.ref, 255) ?? "";
    const repoId = this.text.integer(this.text.object(head?.repo)?.id);
    if (repoId === undefined || repoId === connection.repositoryId) return ref;
    return (
      this.text.text(head?.label, 255) ??
      `${this.text.text(this.text.object(head?.repo)?.full_name, 200) ?? "fork"}:${ref}`
    ).slice(0, 255);
  }

  /**
   * The author's permission on the repository: `app` for the App's own bot,
   * or undefined when it cannot be read (no App, a revoked installation, a
   * rate limit), never a reason to drop the delivery. Remembered ten
   * minutes per repository and author, so a backfill asks once per author.
   */
  protected async permissionOf(
    connection: ProjectRepository,
    login: string | undefined,
  ): Promise<string | undefined> {
    if (!login) return undefined;
    try {
      const bot = await this.tokens.botIdentity();
      if (login === bot.name) return "app";
    } catch {
      // No App: the permission below fails the same way.
    }
    const key = `${connection.repositoryId}:${login}`;
    const now = this.dateTime.nowMillis();
    const known = this.permissions.get(key);
    if (known && known.until > now) return known.permission;
    try {
      const token = await this.repositories.readToken(connection);
      const permission = await this.client.getCollaboratorPermission(
        token,
        { owner: connection.owner, name: connection.name },
        login,
      );
      if (this.permissions.size > 1_000) this.permissions.clear();
      this.permissions.set(key, { permission, until: now + 600_000 });
      return permission;
    } catch {
      return undefined;
    }
  }

  // ---- handlers -----------------------------------------------------------

  protected async pullRequest(context: GitHubWebhookContext): Promise<void> {
    const data = this.text.object(context.payload.pull_request);
    if (!data || !context.connection) return;
    await this.upsertFrom(context.connection, data, {
      event: context.event,
      ...(context.action ? { action: context.action } : {}),
    });
  }

  protected async review(context: GitHubWebhookContext): Promise<void> {
    const data = this.text.object(context.payload.pull_request);
    const review = this.text.object(context.payload.review);
    if (!data || !review || !context.connection) return;
    if (context.action !== "submitted") return;
    const row = await this.upsertFrom(context.connection, data, {
      event: context.event,
      action: context.action,
    });
    if (!row) return;
    // Only a review by someone with a say on the repository moves the
    // state: anyone may approve a public pull request on GitHub.
    const association = this.text.text(review.author_association, 30) ?? "";
    if (!["OWNER", "MEMBER", "COLLABORATOR"].includes(association)) return;
    const state = (this.text.text(review.state, 30) ?? "").toLowerCase();
    const next =
      state === "approved"
        ? "approved"
        : state === "changes_requested"
          ? "changes_requested"
          : undefined;
    if (!next || row.review === next) return;
    const updated = await this.write(
      context.connection,
      row,
      { review: next },
      { action: "reviewed" },
    );
    await this.notify({
      row: updated,
      before: row,
      event: context.event,
      action: "reviewed",
      connection: context.connection,
    });
  }

  protected async checkSuite(context: GitHubWebhookContext): Promise<void> {
    const suite = this.text.object(context.payload.check_suite);
    if (!suite || !context.connection) return;
    const id = this.text.integer(suite.id);
    const headSha = this.text.text(suite.head_sha, 64);
    if (id === undefined || !headSha) return;
    const value = `${this.text.text(suite.status, 20) ?? "queued"}:${this.text.text(suite.conclusion, 20) ?? ""}`;
    await this.forHead(context, headSha, (row) => ({
      suites: { ...row.suites, [String(id)]: value },
    }));
  }

  protected async checkRun(context: GitHubWebhookContext): Promise<void> {
    const run = this.text.object(context.payload.check_run);
    if (!run || !context.connection) return;
    const id = this.text.integer(run.id);
    const headSha = this.text.text(run.head_sha, 64);
    if (id === undefined || !headSha) return;
    const suite = this.text.object(run.check_suite);
    const suiteId = this.text.integer(suite?.id);
    const status = this.text.text(run.status, 20) ?? "queued";
    const conclusion = this.text.text(run.conclusion, 20) ?? "";
    const failing =
      status === "completed" &&
      PullRequestStateService.FAILING.includes(conclusion);
    await this.forHead(context, headSha, (row) => {
      const list = (row.failingChecks ?? []).filter((it) => it.id !== id);
      if (failing) {
        list.push({
          id,
          name: this.text.text(run.name, 200) ?? `check ${id}`,
          ...(this.text.text(run.html_url, 500)
            ? { url: this.text.text(run.html_url, 500) }
            : {}),
        });
      }
      return {
        failingChecks: list.slice(-20),
        // A run's suite is pending until the suite itself completes.
        ...(suiteId !== undefined && !(row.suites ?? {})[String(suiteId)]
          ? {
              suites: {
                ...row.suites,
                [String(suiteId)]: "in_progress:",
              },
            }
          : {}),
      };
    });
  }

  protected async status(context: GitHubWebhookContext): Promise<void> {
    if (!context.connection) return;
    const sha = this.text.text(context.payload.sha, 64);
    const name = this.text.text(context.payload.context, 200);
    const state = this.text.text(context.payload.state, 20);
    if (!sha || !name || !state) return;
    await this.forHead(context, sha, (row) => ({
      statuses: { ...row.statuses, [name]: state },
    }));
  }

  protected async workflowRun(context: GitHubWebhookContext): Promise<void> {
    const run = this.text.object(context.payload.workflow_run);
    if (!run || !context.connection || context.action !== "completed") return;
    // A fork's run names its own branch, which may be called `main`.
    const headRepo = this.text.integer(
      this.text.object(run.head_repository)?.id,
    );
    if (
      headRepo !== undefined &&
      headRepo !== context.connection.repositoryId
    ) {
      return;
    }
    const id = this.text.integer(run.id);
    if (id === undefined) return;
    const change: WorkflowRunChange = {
      connection: context.connection,
      id,
      name: this.text.text(run.name, 200) ?? `run ${id}`,
      conclusion: this.text.text(run.conclusion, 20) ?? "",
      branch: this.text.text(run.head_branch, 255) ?? "",
      url: this.text.text(run.html_url, 500) ?? "",
      headSha: this.text.text(run.head_sha, 64) ?? "",
    };
    for (const listener of this.workflowListeners) await listener(change);
  }

  protected async push(context: GitHubWebhookContext): Promise<void> {
    if (!context.connection) return;
    const ref = this.text.text(context.payload.ref, 255) ?? "";
    const raw = Array.isArray(context.payload.commits)
      ? context.payload.commits.slice(0, 100)
      : [];
    const commits = raw.flatMap((it) => {
      const commit = this.text.object(it);
      const sha = this.text.text(commit?.id, 40);
      return sha && /^[0-9a-f]{7,40}$/i.test(sha)
        ? [{ sha, message: this.text.text(commit?.message, 2_000) ?? "" }]
        : [];
    });
    const change = { connection: context.connection, ref, commits };
    for (const listener of this.pushListeners) await listener(change);
  }

  /**
   * Applies a check or status update to every pull request whose head is
   * `sha`, recomputes the rollup, and tells the listeners on a change.
   */
  protected async forHead(
    context: GitHubWebhookContext,
    sha: string,
    patch: (row: PullRequestRow) => Partial<PullRequestRow>,
  ): Promise<void> {
    const connection = context.connection!;
    const rows = await this.rows.findMany({
      where: {
        repositoryId: { eq: connection.repositoryId },
        headSha: { eq: sha },
      },
      limit: 20,
    });
    for (const row of rows) {
      const next = { ...row, ...patch(row) };
      const checks = this.rollup(next.suites ?? {}, next.statuses ?? {});
      const updated = await this.write(
        connection,
        row,
        { ...patch(row), checks },
        context.action ? { action: context.action } : {},
      );
      await this.notify({
        row: updated,
        before: row,
        event: context.event,
        ...(context.action ? { action: context.action } : {}),
        connection,
      });
    }
  }

  protected async notify(change: PullRequestChange): Promise<void> {
    for (const listener of this.pullRequestListeners) await listener(change);
  }
}
