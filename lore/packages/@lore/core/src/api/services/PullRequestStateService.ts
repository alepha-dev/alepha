import { $hook, $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DbConflictError } from "alepha/orm";

import type { ProjectRepository } from "../entities/projectRepositories.ts";
import { type PullRequestRow, pullRequests } from "../entities/pullRequests.ts";
import type { PullRequestState } from "../schemas/pullRequestStateSchema.ts";
import { GitHubClient } from "./GitHubClient.ts";
import { GitHubText } from "./GitHubText.ts";
import {
  type GitHubWebhookContext,
  GitHubWebhookHandlers,
} from "./GitHubWebhookHandlers.ts";
import { ProjectRepositoryService } from "./ProjectRepositoryService.ts";

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
  protected readonly handlers = $inject(GitHubWebhookHandlers);
  protected readonly text = $inject(GitHubText);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly repositories = $inject(ProjectRepositoryService);
  protected readonly client = $inject(GitHubClient);
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
   * own bot is never outside. An unread permission is not outside yet.
   */
  outside(row: PullRequestRow): boolean {
    if (row.trustedAt) return false;
    if (row.authorLogin?.endsWith("[bot]")) return false;
    if (!row.authorPermission) return false;
    return !["admin", "maintain", "write"].includes(row.authorPermission);
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

  async trust(row: PullRequestRow, userId: string): Promise<PullRequestRow> {
    return await this.rows.updateById(row.id, {
      trustedBy: userId,
      trustedAt: this.dateTime.nowISOString(),
    });
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
      headRef: this.text.text(head?.ref, 255) ?? "",
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
    let row: PullRequestRow;
    if (!before) {
      try {
        row = await this.rows.create({
          id: crypto.randomUUID(),
          ...fields,
          checks: "pending",
          review: "none",
        });
      } catch (error) {
        if (!(error instanceof DbConflictError)) throw error;
        return await this.upsertFrom(connection, data, meta);
      }
    } else {
      row = await this.rows.updateById(before.id, {
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
      });
    }
    if (!before && meta.action === "review_requested") {
      row = await this.rows.updateById(row.id, { review: "requested" });
    }
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
    const state = (this.text.text(review.state, 30) ?? "").toLowerCase();
    const next =
      state === "approved"
        ? "approved"
        : state === "changes_requested"
          ? "changes_requested"
          : undefined;
    if (!next || row.review === next) return;
    const updated = await this.rows.updateById(row.id, { review: next });
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
      const updated = await this.rows.updateById(row.id, {
        ...patch(row),
        checks,
      });
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
