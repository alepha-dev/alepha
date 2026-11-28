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
 * draft state on its own would be the drift the gate it replaced never had,
 * so every one of them comes here.
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
        ? `Cannot mark quest ${ref} ready: it belongs to Epic ${epicRef}, whose status decides. Mark Epic ${epicRef} ready (epic_set_status) and every draft quest in it becomes to do.`
        : `Cannot mark quest ${ref} draft: it belongs to Epic ${epicRef}, whose status decides. Mark Epic ${epicRef} draft (epic_set_status) to take all of its to-do quests back to draft.`,
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
        `Cannot ${verb} quest ${ref}: it is a draft, because Epic ${epicRef} is. Its quests become ready together when Epic ${epicRef} is marked ready (epic_set_status).`,
      );
    }
    if (quest.shelvedAt) {
      throw new BadRequestError(
        `Cannot ${verb} quest ${ref}: it is a shelved draft. Unshelve it (quest_unshelve), mark it ready (quest_ready), then ${verb} it.`,
      );
    }
    throw new BadRequestError(
      `Cannot ${verb} quest ${ref}: it is a draft, not ready to be taken. Mark it ready first (quest_ready, or Mark as ready on its page), then ${verb} it.`,
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
