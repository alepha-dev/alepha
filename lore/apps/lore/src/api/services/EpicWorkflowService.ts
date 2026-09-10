import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError } from "alepha/server";

import { formatReference } from "../../web/app/components/shared/element/typedReference.ts";
import { type Epic, epics } from "../entities/epics.ts";
import { type Quest, quests } from "../entities/quests.ts";
import type { ReleaseCascade } from "../schemas/releaseCascadeSchema.ts";
import { DefaultReleaseService } from "./DefaultReleaseService.ts";
import { LoreAudits } from "./LoreAudits.ts";
import { ReleaseCascadeService } from "./ReleaseCascadeService.ts";

/**
 * The action a caller is about to take on a quest, as the word the refusal
 * uses. The verbs that open or advance work share one message shape; the
 * verb is the only thing that differs between them.
 */
export type EpicWorkflowVerb =
  | "accept"
  | "assign"
  | "complete"
  | "unshelve"
  | "unhold";

/**
 * What a caller is about to do to an epic's quest set. `add` and `remove`
 * are the attach and detach paths; `delete` is `deleteQuest`, which is a
 * removal too, only louder, and gets its own wording so the message can
 * name shelve as the route.
 */
export type EpicPlanEdit =
  | { kind: "add" }
  | { kind: "remove"; quest: Pick<Quest, "shortId"> }
  | { kind: "delete"; quest: Pick<Quest, "shortId"> };

/**
 * The single place the epic workflow is written: which action is allowed in
 * which status, the words a refusal carries, and the two transitions no
 * person makes by hand.
 *
 * ## Four statuses, two of them automatic (#Q2223)
 *
 * `planned` and `ready` are set by hand, both ways, and they are the whole
 * of the manual surface. `in_progress` is written by the first quest of a
 * `ready` epic to be accepted or assigned ({@link startIfReady}), and
 * `completed` by the request that resolves its last open quest
 * ({@link completeIfResolved}). It replaced epic #31's Begin and Conclude
 * clicks, which carried no decision: the Work-on-it prompt told the agent to
 * make both itself.
 *
 * The status is still the permission, which is what epic #31 established and
 * this keeps: an agent told the status on every call worked epic #27 to 9 of
 * 9 while `planned`, so a note is decoration and a refusal is information.
 * One service, so `QuestController`, `EpicController` and the MCP layer
 * cannot drift on the rules. Same reduction, same recorded reason as
 * `EpicVisibilityService`: duplicating a precondition across endpoints is how
 * the 13-endpoint bug happened (folio #20).
 *
 * A refusal is a product surface. An agent reads it and has to know what to
 * do next, so every message names the epic by its per-project number and
 * names the fix, except where the fix is somebody else's call: a `planned`
 * epic's refusal says it is not ready, and deliberately does not tell the
 * agent how to make it ready. All of them are `BadRequestError`, the same
 * 400 the questline gate in `acceptQuest` throws, so the wording reaches the
 * caller on every transport, MCP included.
 *
 * ⚠️ **No status is ever written to a quest row.** Moving an epic out of
 * `planned` releases its quests because the backlog gate stops matching them,
 * not because anything about them changed. The one carve-out is the default
 * release on {@link startIfReady}, which writes `releaseId` and nothing else.
 */
export class EpicWorkflowService {
  protected readonly epics = $repository(epics);
  protected readonly quests = $repository(quests);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly audits = $inject(LoreAudits);
  protected readonly cascade = $inject(ReleaseCascadeService);
  /**
   * Where an epic ships when nobody said (#E48). Read when the epic starts,
   * and best effort: starting an epic must never fail over a planning
   * convenience.
   */
  protected readonly defaults = $inject(DefaultReleaseService);

  /**
   * The epic a quest belongs to, or `undefined` when it has none or the row
   * is gone. `quests.epicId` is `ON DELETE SET NULL`, so a physical delete
   * clears the column; a soft-deleted epic does not, and `findOne` respects
   * `deletedAt`, so it comes back as missing here. A missing epic row is
   * never a reason to refuse: the quest is loose, which is the most common
   * case of all. `QuestController.getQuestline` applies the same reading.
   */
  async epicOf(quest: Pick<Quest, "epicId">): Promise<Epic | undefined> {
    if (quest.epicId == null) return undefined;
    return await this.epics.findOne({ where: { id: { eq: quest.epicId } } });
  }

  /**
   * You can work on a quest only if its epic is `ready` or `in_progress`.
   *
   * Called first thing by every action that opens or advances work: accept,
   * assign, complete, unshelve and unhold. Accept and complete are the
   * obvious two; the other three each open work by another door
   * (`assignQuest` skips `acceptQuest`, unshelving turns a resolved quest
   * back into an open one, unholding turns a blocked one back into a
   * workable one), and gating the obvious two alone leaves three ways in.
   *
   * Shelve, hold and unassign are deliberately NOT gated: they move a quest
   * toward resolution or away from work, and shelving is the only exit for a
   * `new` quest sitting in a `completed` epic from before this rule existed.
   *
   * Unshelve and unhold are also allowed while `planned` or `ready`.
   * Shelving, holding and their reversals there are edits to an open plan
   * ("out of scope" and "back in scope", "blocked" and "unblocked"), and a
   * plan that lets a quest be set aside but never brought back would be
   * asymmetric for no reason. They start nothing. What neither may do is
   * re-open work inside a `completed` epic.
   *
   * ⚠️ A `ready` epic is where the START is decided, so this is also where
   * `dependsOn` is checked: accepting, assigning or completing a quest of a
   * ready epic is what moves it to `in_progress`, and that move is refused
   * while the predecessor is not `completed`. The caller performs the move
   * with {@link startIfReady} once its own write has succeeded, so a refusal
   * further down (the questline gate, an unknown assignee) never leaves an
   * epic started with nothing accepted in it.
   *
   * Reported BEFORE the questline gate where both apply, because the epic
   * reason is usually fixed somewhere else first.
   */
  async assertQuestWorkable(
    quest: Pick<Quest, "shortId" | "epicId">,
    verb: EpicWorkflowVerb,
  ): Promise<void> {
    const epic = await this.epicOf(quest);
    if (!epic || epic.status === "in_progress") return;

    const reopensPlan = verb === "unshelve" || verb === "unhold";

    if (epic.status === "planned") {
      if (reopensPlan) return;
      throw new BadRequestError(
        `Cannot ${verb} quest ${formatReference("quest", quest.shortId)}: Epic ${formatReference("epic", epic.number)} is planned, and not ready for development yet.`,
      );
    }

    if (epic.status === "ready") {
      if (reopensPlan) return;
      await this.assertCanStart(epic, quest, verb);
      return;
    }

    throw new BadRequestError(
      `Cannot ${verb} quest ${formatReference("quest", quest.shortId)}: Epic ${formatReference("epic", epic.number)} is completed. File this in a new epic.`,
    );
  }

  /**
   * A `ready` epic cannot start while its predecessor is not completed.
   *
   * This is the gate `epics.dependsOn` did not have on 2026-09-01 and has
   * since 2026-09-04; the column's own comment holds the record of both
   * decisions, and of why it moved from Begin to the start with #Q2223. One
   * lookup and not a graph walk, since an epic takes at most one predecessor;
   * cycles are refused on write by `EpicDependencyService`, which is a
   * different failure with a different message.
   *
   * A deleted predecessor is `ON DELETE SET NULL` and allows; a soft-deleted
   * one is missing here and allows too, for the reason {@link epicOf} gives.
   */
  protected async assertCanStart(
    epic: Pick<Epic, "number" | "dependsOn">,
    quest: Pick<Quest, "shortId">,
    verb: EpicWorkflowVerb,
  ): Promise<void> {
    if (epic.dependsOn == null) return;

    const predecessor = await this.epics.findOne({
      where: { id: { eq: epic.dependsOn } },
    });
    if (!predecessor || predecessor.status === "completed") return;

    throw new BadRequestError(
      `Cannot ${verb} quest ${formatReference("quest", quest.shortId)}: Epic ${formatReference("epic", epic.number)} depends on Epic ${formatReference("epic", predecessor.number)}, which is not completed.`,
    );
  }

  /**
   * A quest enters or leaves an epic only while the epic is `planned` or
   * `ready`.
   *
   * Once the epic is `in_progress` the quest set is what was committed, and
   * once it is `completed` nothing moves at all. Whatever the quest's own
   * status: the review of epic #31 proposed letting a completed or shelved
   * quest through in any phase, since it carries no work, and the owner
   * declined it ("freeze for now"). One rule, no carve-out. If it is ever
   * wanted, it is one condition here.
   *
   * The `add` message is the one that teaches the workflow, so it names both
   * escape routes. `remove` and `delete` name shelve, which is what "this
   * quest will not be done" looks like inside a frozen plan.
   */
  assertPlanEditable(
    epic: Pick<Epic, "number" | "status">,
    edit: EpicPlanEdit,
  ): void {
    if (epic.status === "planned" || epic.status === "ready") return;

    const frozen = epic.status === "in_progress";
    const phase = frozen
      ? "is in progress. Its plan is frozen."
      : "is completed.";

    if (edit.kind === "add") {
      const fix = frozen
        ? " File this in a new epic, or add an objective to a quest already in it."
        : " File this in a new epic.";
      throw new BadRequestError(
        `Cannot add a quest: Epic ${formatReference("epic", epic.number)} ${phase}${fix}`,
      );
    }

    const fix = frozen ? " Shelve it instead." : "";
    throw new BadRequestError(
      `Cannot ${edit.kind} quest ${formatReference("quest", edit.quest.shortId)}: Epic ${formatReference("epic", epic.number)} ${phase}${fix}`,
    );
  }

  /**
   * {@link assertPlanEditable} for a caller that holds the quest and not the
   * epic: `deleteQuest`, which only knows the row it is about to remove.
   */
  async assertQuestDeletable(
    quest: Pick<Quest, "shortId" | "epicId">,
  ): Promise<void> {
    const epic = await this.epicOf(quest);
    if (!epic) return;
    this.assertPlanEditable(epic, { kind: "delete", quest });
  }

  /**
   * The only status moves a person makes: `planned` to `ready` and back.
   *
   * `ready` to `planned` stays open because nothing has started: the epic
   * leaves `ready` on its own the moment a quest is accepted, so a ready
   * epic is by construction one nobody is working. Anything else is refused.
   * `in_progress` and `completed` are never a request's to ask for (the body
   * schema does not even offer them), and an epic that has left `ready` does
   * not come back: its plan is frozen, or it is the record.
   *
   * Asking for the status the epic already has never reaches this; the
   * controller answers it as a no-op first.
   */
  assertManualEdge(
    epic: Pick<Epic, "number" | "status">,
    to: "planned" | "ready",
  ): void {
    if (epic.status === "planned" && to === "ready") return;
    if (epic.status === "ready" && to === "planned") return;

    const move = `Cannot move Epic ${formatReference("epic", epic.number)} from ${epic.status} to ${to}.`;
    if (epic.status === "completed") {
      throw new BadRequestError(
        `${move} It is completed. Create a new epic that depends on it.`,
      );
    }
    throw new BadRequestError(
      `${move} Work has started and its plan is frozen. Shelve what will not be done, or create a new epic.`,
    );
  }

  /**
   * Move a `ready` epic to `in_progress`, because one of its quests was just
   * accepted, assigned or completed.
   *
   * Called by the quest actions AFTER their own write, never before: the
   * check that may refuse the start ({@link assertCanStart}) already ran in
   * {@link assertQuestWorkable}, and writing the epic last means no refusal
   * later in the handler can leave a started epic with nothing started in
   * it. Answers `undefined`, and writes nothing, for a loose quest and for an
   * epic in any other status, so every caller can call it unconditionally.
   *
   * ⚠️ **The default release lands here**, where Begin used to attach it
   * (#E48). An epic that names no release takes the project's default when
   * work starts, and `ReleaseCascadeService` carries it down to every quest
   * of the epic that named none. Attaching at completion instead would
   * produce an epic that reads 0/0: its quests complete one at a time while
   * the epic still names no release, each stamped individually by
   * `QuestController.attachToDefaultRelease`, and the epic then completes
   * into a release holding none of its own work. Best effort: `openDefault`
   * answers `undefined` for a project with no default, for one whose default
   * has been published, and for a read that failed.
   *
   * The cascade runs AFTER the epic's own write, for the reason
   * `EpicController.updateEpic` gives: there is no transaction to roll back,
   * so the other order can leave quests pointing at a release the epic is
   * not in. `previous` is `null`, and that is load-bearing: the follower test
   * selects exactly the quests that name nothing, and a quest given an
   * explicit release while the epic was being planned keeps its own.
   */
  async startIfReady(
    quest: Pick<Quest, "shortId" | "epicId">,
    user: UserAccountToken | undefined,
  ): Promise<ReleaseCascade | undefined> {
    const epic = await this.epicOf(quest);
    if (!epic || epic.status !== "ready") return undefined;

    const releaseId =
      epic.releaseId == null
        ? (await this.defaults.openDefault(epic.projectId))?.id
        : undefined;

    const updated = await this.epics.updateById(epic.id, {
      status: "in_progress",
      startedAt: this.dt.nowISOString(),
      ...(releaseId != null ? { releaseId } : {}),
    });

    const cascade =
      releaseId != null
        ? await this.cascade.toQuests(updated, null, releaseId)
        : undefined;

    await this.logStatus(epic, "in_progress", user, {
      quest: quest.shortId,
      ...(cascade ? { cascade } : {}),
    });

    return cascade;
  }

  /**
   * Move an `in_progress` epic to `completed`, because the quest just
   * completed or shelved was its last open one.
   *
   * Every quest must be completed or shelved, because `completed` is
   * terminal: an open quest left inside a completed epic could never be
   * accepted again, in any epic. It is the rule `completeQuest` applies one
   * level down, where every objective must be ticked or waived, and shelving
   * is the epic-level equivalent of waiving. It used to be the precondition
   * of a Conclude click; the click only ever restated this count.
   *
   * An ACCEPTED quest counts as open: the state tested is "neither completed
   * nor shelved", not "not accepted".
   *
   * Only from `in_progress`. A `ready` epic whose quests all get shelved
   * stays `ready`, since nothing in it was ever worked, and its plan is still
   * open for a quest that will be. Called AFTER the quest's own write, so the
   * count sees it resolved; a no-op for anything that is not the last one.
   */
  async completeIfResolved(
    quest: Pick<Quest, "shortId" | "epicId">,
    user: UserAccountToken | undefined,
  ): Promise<void> {
    const epic = await this.epicOf(quest);
    if (!epic || epic.status !== "in_progress") return;

    const open = await this.quests.count({
      epicId: { eq: epic.id },
      completedAt: { isNull: true },
      shelvedAt: { isNull: true },
    });
    if (open > 0) return;

    await this.epics.updateById(epic.id, {
      status: "completed",
      completedAt: this.dt.nowISOString(),
    });

    await this.logStatus(epic, "completed", user, { quest: quest.shortId });
  }

  /**
   * The audit row for an automatic move, shaped like the one
   * `EpicController.setEpicStatus` writes for a manual one (`status`, with
   * `from` and `to`), plus the quest whose request caused it. The feed then
   * reads the same whichever way an epic moved, and says why.
   */
  protected async logStatus(
    epic: Pick<Epic, "number" | "title" | "projectId" | "status">,
    to: Epic["status"],
    user: UserAccountToken | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audits.epic.logSuccess("status", {
      ...this.audits.actor(user),
      ...this.audits.scope(epic.projectId),
      resourceType: "epic",
      resourceId: String(epic.number),
      description: epic.title,
      metadata: { from: epic.status, to, ...metadata },
    });
  }
}
