import { ResourceRegistry } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository, DbEntityNotFoundError } from "alepha/orm";

import { projectErrors } from "../entities/projectErrors.ts";
import { QUEST_STATUS_PREFIX } from "../schemas/projectErrorQuestStatus.ts";

/**
 * Hands a forwarded error back to the inbox when its quest is deleted.
 *
 * `error_forward` is one-way: it refuses an error already carrying a
 * `quest:` status. Without this the row is stranded: invisible in the inbox
 * because its status is not `open`, un-forwardable because it looks handled,
 * and pointing at a quest that 404s. The failure it reported goes on
 * happening with nothing left to surface it.
 *
 * Reopening does not contradict the rule that a triage decision survives the
 * next batch (see `absorbErrors`). That rule protects a decision from being
 * undone by NOISE; deleting the quest is the owner deliberately withdrawing
 * the decision, which is the opposite.
 *
 * Deploy subscribes to the `quest` kind's deletion on the core registry, so
 * Work's delete path never reads `projectErrors` (#E75, #Q2610). With no Work
 * module registered the subscription never fires.
 */
export class ProjectErrorQuestHandBack {
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly projectErrors = $repository(projectErrors);

  constructor() {
    this.resources.onDeleted("quest", async (event) => {
      const source = event.row.source as { projectErrorId?: number } | null;
      if (!source?.projectErrorId) return;
      // Only if it still points HERE, checked by the write itself (#Q2550):
      // an error re-forwarded to another quest belongs to that one now, and
      // must not be reopened by this delete. A miss means somebody else moved
      // it, which is fine.
      await this.projectErrors
        .updateOne(
          {
            id: { eq: source.projectErrorId },
            status: { eq: `${QUEST_STATUS_PREFIX}${event.id}` },
          },
          { status: "open" },
        )
        .catch((error: unknown) => {
          if (!(error instanceof DbEntityNotFoundError)) throw error;
        });
    });
  }
}
