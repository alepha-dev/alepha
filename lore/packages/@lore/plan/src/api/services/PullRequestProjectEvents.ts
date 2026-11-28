import {
  LoreDatabase,
  ProjectEventCatalog,
  ProjectEvents,
  PullRequestStateService,
  type PullRequestTransition,
  type SourceEvent,
  type WorkflowRunChange,
} from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $hook, $inject } from "alepha";
import { $repository } from "alepha/orm";

import { PlanGitHubTrail } from "./PlanGitHubTrail.ts";

/**
 * Pull request and CI events in the project event catalog (#Q4368, epic
 * #E177), from the state `PullRequestStateService` keeps.
 *
 * - `pull_request.opened`, `.ready`, `.merged`, `.closed`,
 *   `.review_requested`, `.reviewed`, `.checks_failed`, `.checks_passed`,
 *   `.trusted`, and `workflow_run.failed` on the default branch.
 * - Each is written in the same guarded batch as the transition that raises
 *   it (`onTransition`), so a redelivered delivery emits nothing.
 * - `requires: "github"`: absent from the catalog of a project that is not
 *   connected.
 * - `outside`: an author outside the team (Bay's rule) whom no member
 *   trusted. A prompt trigger does not fire on such an event
 *   (`PromptTriggers`); subscriptions still notify. `pull_request.trusted`
 *   fires the triggers waiting on `pull_request.opened`.
 *
 * `pull_request.added` stays: it means "recorded on a quest or an epic";
 * these mean "happened on GitHub".
 */
export class PullRequestProjectEvents {
  /**
   * The fields every pull request event carries.
   */
  public static readonly FIELDS = {
    number: "number",
    repository: "text",
    pull_request_url: "text",
    author: "text",
    head_ref: "text",
    base_ref: "text",
    quest_shortId: "number",
    outside: "boolean",
    checks: "text",
    review: "text",
    actor_id: "member",
  } as const;

  protected readonly catalog = $inject(ProjectEventCatalog);
  protected readonly states = $inject(PullRequestStateService);
  protected readonly projectEvents = $inject(ProjectEvents);
  protected readonly database = $inject(LoreDatabase);
  protected readonly trail = $inject(PlanGitHubTrail);
  protected readonly projects = $repository(projects);

  constructor() {
    const event = (
      name: string,
      label: string,
      message: (it: Record<string, unknown>) => { title: string; text: string },
    ) =>
      this.catalog.register({
        name,
        label,
        resource: "quests",
        subject: "pull_request",
        fields: { ...PullRequestProjectEvents.FIELDS },
        needs: { capability: "plan" },
        requires: "github",
        permission: "quest:read",
        message: (it) => message(it),
      });
    const pr = (it: Record<string, unknown>) =>
      `#${this.text(it.number)} ${this.text(it.title)}`;
    event("pull_request.opened", "Pull request opened on GitHub", (it) => ({
      title: `Pull request opened: ${pr(it)}`,
      text: it.outside
        ? "By an author outside the team: it waits for a member's trust."
        : `By ${this.text(it.author) || "someone"}.`,
    }));
    event("pull_request.ready", "Pull request ready for review", (it) => ({
      title: `Pull request ready: ${pr(it)}`,
      text: "It left draft.",
    }));
    event("pull_request.merged", "Pull request merged", (it) => ({
      title: `Pull request merged: ${pr(it)}`,
      text: `Into ${this.text(it.base_ref)}.`,
    }));
    event("pull_request.closed", "Pull request closed unmerged", (it) => ({
      title: `Pull request closed: ${pr(it)}`,
      text: "Closed without a merge.",
    }));
    event(
      "pull_request.review_requested",
      "Pull request review requested",
      (it) => ({
        title: `Review requested: ${pr(it)}`,
        text: "A review was requested.",
      }),
    );
    event("pull_request.reviewed", "Pull request reviewed", (it) => ({
      title: `Pull request reviewed: ${pr(it)}`,
      text:
        it.review === "approved"
          ? "It was approved."
          : "Changes were requested.",
    }));
    event("pull_request.checks_failed", "Pull request checks failed", (it) => ({
      title: `Checks failed: ${pr(it)}`,
      text: "A check on its head failed.",
    }));
    event("pull_request.checks_passed", "Pull request checks passed", (it) => ({
      title: `Checks passed: ${pr(it)}`,
      text: "Every check on its head passed.",
    }));
    event("pull_request.trusted", "Pull request trusted", (it) => ({
      title: `Pull request trusted: ${pr(it)}`,
      text: "A member trusted it: agents may act on it now.",
    }));
    this.catalog.register({
      name: "workflow_run.failed",
      label: "Workflow run failed on the default branch",
      resource: "quests",
      subject: "workflow_run",
      fields: {
        workflow: "text",
        branch: "text",
        conclusion: "text",
        run_url: "text",
        head_sha: "text",
      },
      needs: { capability: "plan" },
      requires: "github",
      permission: "quest:read",
      message: (it) => ({
        title: `Workflow failed on ${this.text(it.branch)}: ${this.text(it.workflow)}`,
        text: `It ended ${this.text(it.conclusion)}.`,
      }),
    });
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      this.states.onTransition((transition) => this.eventOf(transition));
      this.states.onWorkflowRun((run) => this.workflowRun(run));
    },
  });

  /**
   * The event a transition raises, or none.
   */
  async eventOf(
    transition: PullRequestTransition,
  ): Promise<SourceEvent | undefined> {
    const name = this.nameOf(transition);
    if (!name) return undefined;
    const { row, connection } = transition;
    const project = await this.projects.getById(connection.projectId);
    const slug = project.slug || `project-${project.id}`;
    const refs = this.trail.references({
      title: row.title,
      branch: row.headRef,
    });
    const quest = refs.quests[0];
    return {
      projectId: connection.projectId,
      name,
      subjectId: row.number,
      ...(transition.actorId ? { actorId: transition.actorId } : {}),
      fields: {
        project: project.title,
        title: row.title,
        number: row.number,
        repository: row.repository,
        pull_request_url: row.url,
        ...(row.authorLogin ? { author: row.authorLogin } : {}),
        head_ref: row.headRef,
        base_ref: row.baseRef,
        ...(quest !== undefined ? { quest_shortId: quest } : {}),
        outside: this.states.outside(row),
        checks: row.checks,
        review: row.review,
        ...(transition.actorId ? { actor_id: transition.actorId } : {}),
        url: quest !== undefined ? `/${slug}/quests/${quest}` : `/${slug}`,
      },
    };
  }

  protected nameOf(transition: PullRequestTransition): string | undefined {
    const { before, row, action } = transition;
    if (action === "trusted") return "pull_request.trusted";
    if (!before) {
      return action === "opened" || action === "reopened"
        ? "pull_request.opened"
        : undefined;
    }
    if (before.state !== row.state) {
      if (row.state === "merged") return "pull_request.merged";
      if (row.state === "closed") return "pull_request.closed";
      if (before.state === "draft" && row.state === "open") {
        return "pull_request.ready";
      }
      if (
        (before.state === "closed" || before.state === "merged") &&
        action === "reopened"
      ) {
        return "pull_request.opened";
      }
    }
    if (before.review !== row.review) {
      if (row.review === "requested") return "pull_request.review_requested";
      if (row.review === "approved" || row.review === "changes_requested") {
        return "pull_request.reviewed";
      }
    }
    if (before.checks !== row.checks) {
      if (row.checks === "failing") return "pull_request.checks_failed";
      if (row.checks === "passing") return "pull_request.checks_passed";
    }
    return undefined;
  }

  protected async workflowRun(run: WorkflowRunChange): Promise<void> {
    if (run.branch !== run.connection.defaultBranch) return;
    if (
      !["failure", "timed_out", "cancelled", "action_required"].includes(
        run.conclusion,
      )
    ) {
      return;
    }
    const project = await this.projects.getById(run.connection.projectId);
    const recorded = await this.projectEvents.emit({
      projectId: project.id,
      name: "workflow_run.failed",
      subjectId: run.id,
      jobId: null,
      fields: {
        project: project.title,
        title: run.name,
        workflow: run.name,
        branch: run.branch,
        conclusion: run.conclusion,
        run_url: run.url,
        head_sha: run.headSha,
        url: `/${project.slug || `project-${project.id}`}`,
      },
    });
    await this.database.batch(recorded.statements);
    await recorded.committed();
  }

  protected text(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return "";
  }
}
