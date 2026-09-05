import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { formatReference } from "../../web/app/components/shared/element/typedReference.ts";
import { type Epic, epics } from "../entities/epics.ts";
import { type Quest, quests } from "../entities/quests.ts";

/**
 * The action a caller is about to take on a quest, as the word the refusal
 * uses. Five actions open or advance work and all five share one message
 * shape; the verb is the only thing that differs between them.
 */
export type EpicWorkflowVerb =
  | "accept"
  | "assign"
  | "complete"
  | "reopen"
  | "unshelve";

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
 * which phase, and the exact words a refusal carries.
 *
 * `planned | active | done` used to be labels with no consequence: every
 * transition was legal, nothing was refused, and an agent told the status on
 * every call ignored it (epic #27 was worked to 9 of 9 while `planned`).
 * After epic #31 the status IS the permission, and this service is where
 * that permission is decided, once, so `QuestController`, `EpicController`
 * and the MCP layer cannot drift on the rules. Same reduction, same recorded
 * reason as `EpicVisibilityService`: duplicating a precondition across
 * endpoints is how the 13-endpoint bug happened (folio #20). That service
 * answers "which quests are visible"; this one answers "is this action
 * allowed in this phase".
 *
 * A refusal is a product surface. An agent reads it and has to know what to
 * do next, so every message names the epic by its per-project number and
 * names the fix. All of them are `BadRequestError`: the same 400 the
 * questline gate in `acceptQuest` throws, so the wording reaches the caller
 * on every transport, MCP included.
 *
 * ⚠️ This service never writes. It reads epics and quests and throws. The
 * invariant that activating an epic is one write against the epic row, and
 * never a write to a quest row, is untouched by anything here.
 *
 * The ratchet itself (which status edges exist, and the same-status no-op)
 * lives in `EpicController.setEpicStatus`; the two gate questions the edges
 * consult are {@link assertCanBegin} and {@link assertCanConclude}.
 */
export class EpicWorkflowService {
  protected readonly epics = $repository(epics);
  protected readonly quests = $repository(quests);

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
   * You can work on a quest only if its epic is `active`.
   *
   * Called first thing by every action that opens or advances work: accept,
   * assign, complete, reopen and unshelve. Accept and complete are the
   * obvious two; the other three each open work by another door
   * (`assignQuest` skips `acceptQuest`, the kanban board reopens by drag,
   * unshelving turns a resolved quest back into an open one), and gating
   * the obvious two alone leaves three ways in.
   *
   * Shelve and unassign are deliberately NOT gated: they move a quest toward
   * resolution, and shelving is the only exit for a `new` quest sitting in a
   * `done` epic from before this rule existed.
   *
   * Unshelve is the one verb that is also allowed while `planned`. Shelving
   * and unshelving during planning are edits to an open plan ("out of scope"
   * and "back in scope"), and a plan that lets a quest be shelved but never
   * brought back until the epic begins would be asymmetric for no reason.
   * What unshelve may not do is re-open work inside a `done` epic.
   *
   * Reported BEFORE the questline gate where both apply, because the epic
   * reason is fixed by a single click somewhere else.
   */
  async assertQuestWorkable(
    quest: Pick<Quest, "shortId" | "epicId">,
    verb: EpicWorkflowVerb,
  ): Promise<void> {
    const epic = await this.epicOf(quest);
    if (!epic || epic.status === "active") return;

    if (epic.status === "planned") {
      if (verb === "unshelve") return;
      throw new BadRequestError(
        `Cannot ${verb} quest ${formatReference("quest", quest.shortId)}: Epic ${formatReference("epic", epic.number)} is planned. Begin it first.`,
      );
    }
    throw new BadRequestError(
      `Cannot ${verb} quest ${formatReference("quest", quest.shortId)}: Epic ${formatReference("epic", epic.number)} is concluded. File this in a new epic.`,
    );
  }

  /**
   * A quest enters or leaves an epic only while the epic is `planned`.
   *
   * Once the epic is `active` the quest set is what was committed, and once
   * it is `done` nothing moves at all. Whatever the quest's own status: the
   * review of epic #31 proposed letting a completed or shelved quest through
   * in any phase, since it carries no work, and the owner declined it
   * ("freeze for now"). One rule, no carve-out. If it is ever wanted, it is
   * one condition here.
   *
   * The `add` message is the one that teaches the workflow, so it names both
   * escape routes. `remove` and `delete` name shelve, which is what "this
   * quest will not be done" looks like inside a frozen plan.
   */
  assertPlanEditable(
    epic: Pick<Epic, "number" | "status">,
    edit: EpicPlanEdit,
  ): void {
    if (epic.status === "planned") return;

    const phase =
      epic.status === "active"
        ? "is active. Its plan is frozen."
        : "is concluded.";

    if (edit.kind === "add") {
      const fix =
        epic.status === "active"
          ? " File this in a new epic, or add an objective to a quest already in it."
          : " File this in a new epic.";
      throw new BadRequestError(
        `Cannot add a quest: Epic ${formatReference("epic", epic.number)} ${phase}${fix}`,
      );
    }

    const fix = epic.status === "active" ? " Shelve it instead." : "";
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
   * An epic cannot begin while its predecessor is not done.
   *
   * This is the gate `epics.dependsOn` did not have on 2026-09-01 and has
   * since 2026-09-04; the column's own comment holds the record of both
   * decisions. One lookup and not a graph walk, since an epic takes at most
   * one predecessor; cycles are refused on write by `EpicDependencyService`,
   * which is a different failure with a different message.
   *
   * A deleted predecessor is `ON DELETE SET NULL` and allows; a soft-deleted
   * one is missing here and allows too, for the reason {@link epicOf} gives.
   */
  async assertCanBegin(
    epic: Pick<Epic, "number" | "dependsOn">,
  ): Promise<void> {
    if (epic.dependsOn == null) return;

    const predecessor = await this.epics.findOne({
      where: { id: { eq: epic.dependsOn } },
    });
    if (!predecessor || predecessor.status === "done") return;

    throw new BadRequestError(
      `Cannot begin Epic ${formatReference("epic", epic.number)}: it depends on Epic ${formatReference("epic", predecessor.number)}, which is not concluded.`,
    );
  }

  /**
   * An epic cannot conclude while a quest is unresolved.
   *
   * Every quest must be completed or shelved, because `done` is terminal: an
   * open quest left inside a concluded epic could never be accepted again,
   * in any epic. It is the rule `completeQuest` already applies one level
   * down, where every objective must be ticked or waived; shelving is the
   * epic-level equivalent of waiving.
   *
   * An ACCEPTED quest counts as open. The state tested is "neither completed
   * nor shelved", not "not accepted", and an accepted quest that will not be
   * done goes unassign then shelve, which the message says when it applies:
   * shelving from `accepted` stays illegal because `computeProgress` derives
   * its four disjoint buckets from `shelvedAt` never coexisting with
   * `acceptedAt`.
   *
   * Two counts, never cached: the number is what tells the reader how much
   * is left, and "some quests are open" would send them looking.
   */
  async assertCanConclude(epic: Pick<Epic, "id" | "number">): Promise<void> {
    const open = await this.quests.count({
      epicId: { eq: epic.id },
      completedAt: { isNull: true },
      shelvedAt: { isNull: true },
    });
    if (open === 0) return;

    const accepted = await this.quests.count({
      epicId: { eq: epic.id },
      completedAt: { isNull: true },
      shelvedAt: { isNull: true },
      acceptedAt: { isNotNull: true },
    });

    const noun = open === 1 ? "1 quest is" : `${open} quests are`;
    const route =
      accepted > 0
        ? " An accepted quest is unassigned first, then shelved."
        : "";
    throw new BadRequestError(
      `Cannot conclude Epic ${formatReference("epic", epic.number)}: ${noun} still open. Complete or shelve each one.${route}`,
    );
  }
}
