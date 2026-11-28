import { LoreAudits } from "@lore/core/api";
import { formatReference } from "@lore/core/web";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError } from "alepha/server";

import type { Epic } from "../entities/epics.ts";
import { type Quest, quests } from "../entities/quests.ts";

/**
 * The one writer of `quests.draftAt` and `quests.readyAt` (#E178, folio
 * #1552), and the sentences that refuse a draft.
 *
 * A draft is a quest that is specified and not ready to be taken. A loose
 * quest is one when somebody asks (`draft: true` at creation, or
 * `QuestController.draftQuest`), and stops being one when somebody marks it
 * ready (`readyQuest`). A quest filed under an epic is one when its epic is
 * `draft`: the epic's status writes its quests, and the per-quest verbs are
 * refused with a sentence naming the epic.
 *
 * Nothing else writes either column. A write path that changed a quest's
 * draft state on its own would let it drift from its epic's status, so
 * every one of them comes here.
 *
 * Who may, and whether the quest's status allows it, is the caller's to
 * check first, as for `QuestShelvingService`. Each per-quest method saves
 * the row it is given, in place, so the `quests` version column turns a
 * concurrent write into a 409 rather than a silent revert.
 */
export class QuestDraftService {
  protected readonly quests = $repository(quests);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly audits = $inject(LoreAudits);

  /**
   * The columns a new quest starts with: `draftAt` when it is born a draft,
   * nothing otherwise, so a quest is born `todo` unless draft was asked for.
   */
  atCreation(draft: boolean | undefined): Pick<Quest, "draftAt"> {
    return draft ? { draftAt: this.dt.nowISOString() } : {};
  }

  /**
   * Refuse a create that asks for a draft and for its accept at once, before
   * anything is written. `QuestController.createQuest` takes no accept: the
   * callers that chain one onto it (`quest_create`, `lore quest create`)
   * call this first, so the sentence is written once.
   */
  assertCreatable(options: { draft?: boolean; accept?: boolean }): void {
    if (options.draft && options.accept) {
      throw new BadRequestError(
        "Cannot create a quest as a draft and accept it: a draft is not ready to be taken. Nothing was written. Drop one of draft and accept.",
      );
    }
  }

  /**
   * Mark a loose `todo` quest draft, with a `drafted` history entry and an
   * audit row.
   */
  async draft(quest: Quest, user: UserAccountToken): Promise<void> {
    const at = this.dt.nowISOString();
    quest.draftAt = at;
    quest.history.push({ at, by: user.id, action: "drafted" });

    await this.quests.save(quest);
    await this.log("draft", quest, user);
  }

  /**
   * Mark a loose draft ready: `draftAt` cleared, `readyAt` stamped, with a
   * `readied` history entry and an audit row.
   */
  async ready(quest: Quest, user: UserAccountToken): Promise<void> {
    const at = this.dt.nowISOString();
    quest.draftAt = undefined;
    quest.readyAt = at;
    quest.history.push({ at, by: user.id, action: "readied" });

    await this.quests.save(quest);
    await this.log("ready", quest, user);
  }

  /**
   * Refuse a per-quest draft verb on a quest its epic owns. The epic's status
   * decides whether its quests are drafts, so the sentence names the epic and
   * the call that moves it.
   */
  assertLoose(
    quest: Pick<Quest, "shortId">,
    epic: Pick<Epic, "number" | "status"> | undefined,
    verb: "draft" | "ready",
  ): void {
    if (!epic) return;
    const ref = formatReference("quest", quest.shortId);
    const epicRef = formatReference("epic", epic.number);
    throw new BadRequestError(
      verb === "ready"
        ? `Cannot mark quest ${ref} ready: it belongs to Epic ${epicRef}, whose status decides. Mark Epic ${epicRef} ready (epic_set_status, or lore epic set status) and every draft quest in it becomes to do.`
        : `Cannot mark quest ${ref} draft: it belongs to Epic ${epicRef}, whose status decides. Mark Epic ${epicRef} draft (epic_set_status, or lore epic set status) to take all of its to-do quests back to draft.`,
    );
  }

  /**
   * Refuse a verb that starts or blocks work (accept, assign, hold) on a
   * quest carrying `draftAt`, whatever its status reads (#E178 review, item
   * 22): accepting a shelved quest unshelves it, so a refusal keyed on the
   * `draft` status would let a shelved draft through to an accepted quest
   * still marked draft.
   *
   * The sentence says how to make it ready: by hand for a loose quest, by
   * its epic for one the epic owns.
   */
  assertNotDraft(
    quest: Pick<Quest, "shortId" | "draftAt" | "shelvedAt">,
    epic: Pick<Epic, "number"> | undefined,
    verb: string,
  ): void {
    if (!quest.draftAt) return;
    const ref = formatReference("quest", quest.shortId);
    if (epic) {
      const epicRef = formatReference("epic", epic.number);
      throw new BadRequestError(
        `Cannot ${verb} quest ${ref}: it is a draft, because Epic ${epicRef} is. Its quests become ready together when Epic ${epicRef} is marked ready (epic_set_status, or lore epic set status).`,
      );
    }
    if (quest.shelvedAt) {
      throw new BadRequestError(
        `Cannot ${verb} quest ${ref}: it is a shelved draft. Unshelve it (quest_unshelve, or lore quest unshelve), mark it ready (quest_ready, or lore quest ready), then ${verb} it.`,
      );
    }
    throw new BadRequestError(
      `Cannot ${verb} quest ${ref}: it is a draft, not ready to be taken. Mark it ready first (quest_ready, lore quest ready, or Mark as ready on its page), then ${verb} it.`,
    );
  }

  /**
   * An epic is marked ready: every quest of it still marked draft becomes
   * to do, in ONE statement, `readyAt` stamped (#Q4373). Only where
   * `draft_at IS NOT NULL` (#E178 review, item 4): a completed quest, or one
   * from before the backfill, never gets a `readyAt` it did not earn.
   * Answers the ids written.
   */
  async releaseEpic(epicId: number): Promise<Array<number | string>> {
    return await this.quests.updateMany(
      { epicId: { eq: epicId }, draftAt: { isNotNull: true } },
      { draftAt: null, readyAt: this.dt.nowISOString() },
    );
  }

  /**
   * An epic is marked draft (or comes back from the shelf as one): every
   * quest of it nobody has taken or finished becomes a draft, in ONE
   * statement (#Q4373). "Its to-do quests" are those with no `acceptedAt`
   * and no `completedAt`, shelved and held ones included (#E178 review,
   * item 3): they still read `shelved` or `on_hold`, and read `draft` again
   * once they come back. Answers the ids written.
   */
  async draftEpic(epicId: number): Promise<Array<number | string>> {
    return await this.quests.updateMany(
      {
        epicId: { eq: epicId },
        acceptedAt: { isNull: true },
        completedAt: { isNull: true },
        draftAt: { isNull: true },
      },
      { draftAt: this.dt.nowISOString() },
    );
  }

  /**
   * A quest entered an epic (`EpicController.attachQuest`, the one choke
   * point): into a draft epic, a quest nobody took becomes a draft; into a
   * ready or in-progress one, a draft becomes to do. Written on the row the
   * caller holds, by one guarded update. Answers whether it wrote.
   */
  async onAttach(
    quest: Pick<Quest, "id" | "draftAt" | "acceptedAt" | "completedAt">,
    epic: Pick<Epic, "status">,
  ): Promise<boolean> {
    if (epic.status === "draft") {
      if (quest.draftAt || quest.acceptedAt || quest.completedAt) return false;
      await this.quests.updateById(quest.id, {
        draftAt: this.dt.nowISOString(),
      });
      return true;
    }
    if (!quest.draftAt) return false;
    await this.quests.updateById(quest.id, {
      draftAt: null,
      readyAt: this.dt.nowISOString(),
    });
    return true;
  }

  /**
   * A quest left a draft epic (`EpicController.detachQuest`): it stays a
   * draft, now loose, except a held one (#E178 review, item 21). A loose
   * held draft is left out of the default views and of the On hold filter,
   * and no epic filter reaches it any more, so it loses `draftAt` and comes
   * back to do when its hold lifts. A shelved draft keeps it, and is found
   * under Shelved.
   */
  async onDetach(
    quest: Pick<Quest, "id" | "draftAt" | "heldAt">,
  ): Promise<boolean> {
    if (!quest.draftAt || !quest.heldAt) return false;
    await this.quests.updateById(quest.id, { draftAt: null });
    return true;
  }

  /**
   * Refuse `draft: true` for a quest about to be filed into an epic that is
   * not a draft, before anything is written (#E178 review, items 7 and 23).
   * Its callers run it before `createQuest`, since the quest is filed by a
   * second call: `quest_create`, `lore quest create`. Into a draft epic
   * the quest is a draft whatever was asked, so nothing is refused.
   */
  assertDraftableInto(
    epic: Pick<Epic, "number" | "status"> | undefined,
    draft: boolean | undefined,
  ): void {
    if (!draft || !epic || epic.status === "draft") return;
    const epicRef = formatReference("epic", epic.number);
    throw new BadRequestError(
      `Cannot create a draft quest in Epic ${epicRef}: the epic is "${epic.status}", so its quests are to do, and its status decides. Nothing was written. File it without draft, or as a loose draft.`,
    );
  }

  /**
   * The same audit row `QuestController.logQuest` writes.
   */
  protected async log(
    action: "draft" | "ready",
    quest: Pick<Quest, "shortId" | "title" | "projectId">,
    user: UserAccountToken,
  ): Promise<void> {
    await this.audits.quest.logSuccess(
      action,
      this.audits.resource("quest", quest, user),
    );
  }
}
