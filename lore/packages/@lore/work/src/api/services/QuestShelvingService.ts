import { LoreAudits } from "@lore/core/api";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";

import { type Quest, quests } from "../entities/quests.ts";

/**
 * The quest writes of shelving and unshelving, shared by
 * `QuestController.shelveQuest` / `unshelveQuest` and by the epic shelve
 * (`EpicController.shelveEpic` / `unshelveEpic`, #E78), so a quest shelved
 * with its epic is shelved exactly as one shelved by hand: the same columns,
 * the same history event, the same audit row.
 *
 * Who may, and whether the quest's status and its epic allow it, is the
 * caller's to check first. Each method saves the row it is given, in
 * place, so the
 * `quests` version column turns a concurrent write into a 409 rather than
 * a silent revert.
 */
export class QuestShelvingService {
  protected readonly quests = $repository(quests);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly audits = $inject(LoreAudits);

  /**
   * Shelve a `todo` quest.
   *
   * `withEpic` sets `quests.shelvedWithEpic`, the mark `unshelveEpic` reads
   * to bring back exactly what the epic shelve set aside (folio #1365).
   */
  async shelve(
    quest: Quest,
    user: UserAccountToken,
    options: { withEpic?: boolean } = {},
  ): Promise<void> {
    const at = this.dt.nowISOString();
    quest.shelvedAt = at;
    quest.shelvedBy = user.id;
    if (options.withEpic) quest.shelvedWithEpic = true;
    quest.history.push({ at, by: user.id, action: "shelved" });

    await this.quests.save(quest);
    await this.log("shelve", quest, user, options.withEpic);
  }

  /**
   * Bring a shelved quest back as `todo`, clearing the epic's mark with it.
   */
  async unshelve(
    quest: Quest,
    user: UserAccountToken,
    options: { withEpic?: boolean } = {},
  ): Promise<void> {
    quest.shelvedAt = undefined;
    quest.shelvedBy = undefined;
    quest.shelvedWithEpic = undefined;
    quest.history.push({
      at: this.dt.nowISOString(),
      by: user.id,
      action: "unshelved",
    });

    await this.quests.save(quest);
    await this.log("unshelve", quest, user, options.withEpic);
  }

  /**
   * Hand an open quest back to `todo` so it can be shelved: lift its hold,
   * then clear its assignment, each with its own history event, as
   * `unholdQuest` and `unassignQuest` do.
   *
   * `quests.shelvedAt` is only ever set on a `todo` quest, and the derived
   * status, the progress buckets and the release buckets all rely on it, so
   * the epic shelve goes through `todo` rather than stacking `shelvedAt` on
   * an accepted or held row (folio #1365). The history keeps who held it.
   * Not saved here: `shelve` saves the row once, with all three events.
   */
  release(quest: Quest, user: UserAccountToken): void {
    const at = this.dt.nowISOString();
    if (quest.heldAt) {
      quest.heldAt = undefined;
      quest.heldBy = undefined;
      quest.history.push({ at, by: user.id, action: "unheld" });
    }
    if (quest.acceptedAt) {
      quest.acceptedAt = undefined;
      quest.acceptedBy = undefined;
      quest.kanbanColumn = undefined;
      // Reminders are tied to the assignee, as in `unassignQuest`.
      quest.reminderInterval = undefined;
      quest.reminderNextAt = undefined;
      quest.history.push({ at, by: user.id, action: "unassigned" });
    }
  }

  /**
   * The same audit row `QuestController.logQuest` writes, plus whether the
   * epic did it, so the feed can say why a quest moved.
   */
  protected async log(
    action: "shelve" | "unshelve",
    quest: Pick<Quest, "shortId" | "title" | "projectId">,
    user: UserAccountToken,
    withEpic: boolean | undefined,
  ): Promise<void> {
    await this.audits.quest.logSuccess(action, {
      ...this.audits.actor(user),
      ...this.audits.scope(quest.projectId),
      resourceType: "quest",
      resourceId: String(quest.shortId),
      description: quest.title,
      ...(withEpic ? { metadata: { withEpic: true } } : {}),
    });
  }
}
