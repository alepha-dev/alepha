import { $audit } from "alepha/api/audits";
import type { UserAccountToken } from "alepha/security";

/**
 * The domain events Lore records in the audit log.
 *
 * ## Two layers, one table
 *
 * An audit log answers "what is happening?", and Lore asks that question at
 * two levels:
 *
 * - **App layer** - who created a project, who signed in. No scope, read on
 *   `/admin/audits`.
 * - **Project layer** - who filed a quest, who published a release. Scoped to
 *   one project via {@link scope}, read on that project's Activity page by
 *   its own members.
 *
 * They are the same question at two altitudes, so they share one table rather
 * than growing a second one beside it. The framework's `audits` entity carries
 * `scopeType` / `scopeId` for exactly this, with partial composite indexes
 * leading on the pair, so a project's feed is an index seek rather than a scan
 * over every app's history.
 *
 * ## This file used to argue the opposite, deliberately
 *
 * Its previous docblock excluded quests and folios on the grounds that both
 * carry their own history, shown on the entity itself. That was correct for an
 * admin security log, which is all this was: the bar was "an action an operator
 * would reconstruct months later", and a quest edit does not clear it.
 *
 * The bar is now "an action a project member would want to see on the Activity
 * page", which a quest edit clears easily - it is most of what happens in a
 * project. The old reasoning was not wrong, it was answering a different
 * question, and the Activity page is what changed the question.
 *
 * ## One type per resource kind
 *
 * `type` IS the resource kind and `action` is the verb, so the Activity page's
 * "resource" filter is a filter on `type` and its "what" filter is a filter on
 * `action`. Both are indexed columns. `resourceType` / `resourceId` stay on the
 * row as the link target rather than as filter columns, which is what lets a
 * row render as "completed quest #208" with somewhere to click.
 *
 * This is also why there is no single `lore` type: the admin filter offers
 * `type:action` pairs (#1671), and one type would put `create` in the dropdown
 * once, meaning eight different things.
 *
 * ## Retention
 *
 * Everything here inherits the global default (`auditOptions.retentionDays`,
 * 90 days, admin-tunable at runtime). That is deliberate and it is the growth
 * control: quest updates arrive from MCP traffic at a rate nothing else here
 * approaches, and this table is the one that grows without bound.
 *
 * ⚠️ **Never set `retentionDays: 0` on a project-layer type.** It means "keep
 * forever", and forever on the busiest table in the app is how the D1 database
 * dies. `sigil` is the one override, and it is an override to a longer *finite*
 * window, not to none.
 */
export class LoreAudits {
  /**
   * Project lifecycle. `create` and `delete` are app-layer events: a project
   * being created belongs to the deployment, not to a project that does not
   * exist yet, and a deletion outlives the scope it would have been filed
   * under. `update` is scoped, because by then there is a project to read it
   * on.
   *
   * ⚠️ `transfer` is NOT declared. `leaveProject` says outright that ownership
   * transfer is not implemented, and an action nobody can perform would sit in
   * the filter promising rows that cannot exist.
   */
  readonly project = $audit({
    type: "project",
    description: "Project lifecycle",
    actions: ["create", "update", "delete"],
    // A session editing one resource repeatedly is the everyday case here -
    // an MCP agent, or somebody working through a form - so `update` folds
    // into one row with a count. Five minutes, measured from the row's
    // `createdAt`, so a long editing session becomes several rows rather than
    // one that claims an afternoon.
    coalesce: { actions: ["update"], window: "5m" },
  });

  /**
   * Quest lifecycle, which is most of what happens in a project.
   *
   * `update` carries the changed field names in `metadata.fields` - that is
   * what makes a row readable without diffing anything, and it is why one
   * `update` action covers every field edit instead of one action per field.
   *
   * ⚠️ `objective` was one of these verbs and is gone: ticking a box is a
   * field edit like any other, so it writes `update` with
   * `metadata.fields: ["objectives"]` and folds into the same bursts. Rows
   * already written keep `action: "objective"` and still render, since the
   * feed prints `row.action` raw; they simply stop being offered in the
   * filter. No backfill.
   *
   * Only `update` coalesces. The lifecycle verbs each happen once and are
   * each a distinct fact: two `complete`s in five minutes is a quest
   * completed, reopened and completed again, which is exactly what a reader
   * would want to see as two rows.
   */
  readonly quest = $audit({
    type: "quest",
    description: "Quest lifecycle",
    actions: [
      "create",
      "update",
      "delete",
      "accept",
      "assign",
      "unassign",
      "complete",
      "reopen",
      "shelve",
      "unshelve",
      "comment",
      "attachment",
      "commit",
    ],
    // A session editing one resource repeatedly is the everyday case here -
    // an MCP agent, or somebody working through a form - so `update` folds
    // into one row with a count. Five minutes, measured from the row's
    // `createdAt`, so a long editing session becomes several rows rather than
    // one that claims an afternoon.
    coalesce: { actions: ["update"], window: "5m" },
  });

  readonly epic = $audit({
    type: "epic",
    description: "Epic lifecycle",
    actions: ["create", "update", "delete", "status", "attach", "detach"],
    // A session editing one resource repeatedly is the everyday case here -
    // an MCP agent, or somebody working through a form - so `update` folds
    // into one row with a count. Five minutes, measured from the row's
    // `createdAt`, so a long editing session becomes several rows rather than
    // one that claims an afternoon.
    coalesce: { actions: ["update"], window: "5m" },
  });

  /**
   * `revert` is here and `read` is not: folios keep their own revision list,
   * and what the feed adds is that somebody moved the folio backwards, which
   * the revision list shows as just another revision.
   */
  readonly folio = $audit({
    type: "folio",
    description: "Folio lifecycle",
    actions: ["create", "update", "delete", "revert", "move"],
    // A session editing one resource repeatedly is the everyday case here -
    // an MCP agent, or somebody working through a form - so `update` folds
    // into one row with a count. Five minutes, measured from the row's
    // `createdAt`, so a long editing session becomes several rows rather than
    // one that claims an afternoon.
    coalesce: { actions: ["update"], window: "5m" },
  });

  /**
   * Publishing is one-way and freezes the record, so it is exactly the kind of
   * thing somebody comes back to. `reopen` is its undo and belongs beside it:
   * a release that was published, reopened and published again reads as one
   * event without it.
   */
  readonly release = $audit({
    type: "release",
    description: "Release lifecycle",
    actions: ["create", "update", "delete", "publish", "reopen"],
    // A session editing one resource repeatedly is the everyday case here -
    // an MCP agent, or somebody working through a form - so `update` folds
    // into one row with a count. Five minutes, measured from the row's
    // `createdAt`, so a long editing session becomes several rows rather than
    // one that claims an afternoon.
    coalesce: { actions: ["update"], window: "5m" },
  });

  /**
   * `accept` and `reject` are triage decisions, which are the owner's
   * judgement rather than a data change: the row survives either way, and what
   * is worth recording is who decided and when.
   */
  readonly feedback = $audit({
    type: "feedback",
    description: "Feedback lifecycle and triage",
    actions: ["create", "accept", "reject", "comment"],
  });

  /**
   * `join` and `leave` rather than `add` and `remove`, because both sides
   * exist: a member joins by accepting an invitation, and leaves either by
   * their own hand (`leaveProject`) or the owner's (`removeMember`, #1695).
   * Who did it is the actor on the row, which is what tells the two apart.
   */
  readonly member = $audit({
    type: "member",
    description: "Project membership",
    actions: ["join", "leave"],
  });

  /**
   * An app instance is a deploy target, which is why it is audited at all: it
   * is the row epic #1 resolves an estate from, so who created it and who
   * repointed it are questions somebody comes back to.
   *
   * `update` folds into one row with a count, like every other editable
   * resource here - renaming both halves is two PATCHes from one settings page
   * and reads better as one event. `delete` is not folded and never should be:
   * deleting an instance takes its sigil and that app's whole analytics
   * history with it.
   */
  readonly app = $audit({
    type: "app",
    description: "App instances and their deploy targets",
    actions: ["create", "update", "delete"],
    coalesce: { actions: ["update"], window: "5m" },
  });

  /**
   * A sigil IS a credential: its token is what an enrolled app authenticates
   * with. `rotate` is the one update in this file for that reason, and the
   * retention is the longest for the same one - credential events are what you
   * go back through after a leak, and "how long ago was that token rotated"
   * has a long tail.
   */
  readonly sigil = $audit({
    type: "sigil",
    description: "App enrolment credentials",
    actions: ["create", "rotate", "delete"],
    retentionDays: 730,
  });

  /**
   * An estate is a credential too: the secret a machine dials in with, and
   * later (epic #22) a token into somebody's cloud account. Same retention as
   * sigils, for the same reason. `create`, `update`, `rotate` and `delete`
   * are app-layer, since an estate belongs to a user and not to a project;
   * `attach` and `detach` are the lending (#1837) and carry the project
   * scope, because a project gaining or losing a deploy destination is what
   * that project's members want to see on their Activity page.
   */
  readonly estate = $audit({
    type: "estate",
    description: "Deploy destinations and their credentials",
    actions: ["create", "update", "rotate", "delete", "attach", "detach"],
    retentionDays: 730,
  });

  /**
   * Every `(type, action)` pair the project layer can write, for the Activity
   * page's two dropdowns.
   *
   * Read off the declarations above rather than restated as a list, so a new
   * action appears in the filter the moment it exists and a removed one stops
   * being offered. The framework's own `getDistinctActions()` is the wrong
   * source here: it answers with every registered type in the container, which
   * on this page would offer `user:login` and `parameter:create` as things
   * that could have happened inside a project.
   *
   * `project` is included even though two of its three actions are app-layer:
   * `project:update` is scoped, and an action that can never match simply
   * returns no rows, which is what an empty filter result is for.
   */
  projectLayerActions(): Array<{ type: string; action: string }> {
    return [
      this.quest,
      this.epic,
      this.folio,
      this.release,
      this.feedback,
      this.member,
      this.app,
      this.sigil,
      this.estate,
      this.project,
    ].flatMap((audit) =>
      audit.actions.map((action) => ({ type: audit.type, action })),
    );
  }

  /**
   * The three identity fields every row here carries, from the caller's token.
   *
   * `email` and `realm` are optional on `UserAccountToken`, so this hands back
   * what is there rather than asserting a shape. The id alone survives a user
   * deletion as a reference to nothing, which is why the email is copied onto
   * the row instead of joined at read time.
   */
  actor(user: UserAccountToken | undefined): {
    userId?: string;
    userEmail?: string;
    userRealm?: string;
  } {
    if (!user) return {};
    return {
      userId: user.id,
      userEmail: user.email,
      userRealm: user.realm,
    };
  }

  /**
   * The project a project-layer event belongs to.
   *
   * Both halves together, never one: every project-layer index leads on the
   * pair, so a `scopeId` without a `scopeType` is a row the Activity page will
   * never return. Spreading this helper is what makes that impossible to get
   * half right.
   */
  scope(projectId: number): { scopeType: string; scopeId: string } {
    return { scopeType: "project", scopeId: String(projectId) };
  }
}
