import {
  LoreAudits,
  ResourceLinkService,
  ResourceRegistry,
} from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";

import { type Quest, quests } from "../entities/quests.ts";

/**
 * The one way a quest row goes: `QuestController.deleteQuest` for a single
 * quest, and `EpicController.deleteEpic` for every quest of the epic it
 * deletes (#Q2666). Who may delete, and whether the quest's epic allows it,
 * is the caller's to check first; this is only what a delete DOES, so the
 * two paths cannot drift on it.
 *
 * It writes three times before the row goes: it clears dependents'
 * `dependsOn`, tells the registry (Deploy hands a forwarded blight back to
 * its inbox), then removes the outbound links and the row. No transaction
 * (D1 has none), and none is needed: the order is the safe one. A failure
 * partway leaves dependencies severed or a blight reopened next to a quest
 * that still exists, and a retry of the delete converges on the intended end
 * state.
 */
export class QuestDeletionService {
  protected readonly quests = $repository(quests);
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly linkService = $inject(ResourceLinkService);
  protected readonly audits = $inject(LoreAudits);

  async delete(
    quest: Quest,
    user: UserAccountToken | undefined,
  ): Promise<void> {
    // Clear dependents' `dependsOn` so the dependency graph does not keep
    // edges to a deleted quest. `null`, not `undefined`: the repository
    // strips undefined keys from an update, which made this a no-op.
    //
    // One statement rather than a read plus an update per dependent: on
    // D1 each of those was a round trip.
    await this.quests.updateMany(
      { dependsOn: { eq: quest.id } },
      { dependsOn: null },
    );

    // Whoever subscribed to a quest's deletion runs now, with the row
    // still readable: Deploy hands a forwarded blight back to its inbox
    // (`BlightQuestHandBack`). Through the registry, so this module never
    // reads `blights` (#E75, #Q2610).
    await this.resources.deleted({
      kind: "quest",
      id: quest.id,
      projectId: quest.projectId,
      row: quest,
    });

    // `folio_links.from_id` is not a foreign key, so nothing in the
    // database clears this quest's outbound links — see
    // `ResourceLinkService.deleteLinksFrom`. Inbound rows are left alone on
    // purpose: a reference to a deleted quest is a broken link, which is
    // what the reader should see.
    await this.linkService.deleteLinksFrom({ kind: "quest", id: quest.id });
    await this.quests.deleteById(quest.id);

    // Logged from the row the caller read: once it is gone, an id names
    // nothing and the feed has no title to print. Same row shape as
    // `QuestController.logQuest`.
    await this.audits.quest.logSuccess("delete", {
      ...this.audits.actor(user),
      ...this.audits.scope(quest.projectId),
      resourceType: "quest",
      resourceId: String(quest.shortId),
      description: quest.title,
    });
  }
}
