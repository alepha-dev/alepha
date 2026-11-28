import type { Quest } from "../entities/quests.ts";
import type {
  QuestResource,
  QuestStatus,
} from "../schemas/questResourceSchema.ts";

/**
 * Maps a quest entity to a quest resource with computed metadata.
 */
export class QuestResourceMapper {
  /**
   * Derive the lifecycle status from the timestamp columns.
   *
   * The single source of truth for "what state is this quest in" — the
   * resource metadata, the controller's transition guards and the MCP
   * tools all read it from here rather than re-deriving it, so a change
   * to the precedence cannot leave one caller disagreeing with another.
   */
  questStatus(
    quest: Pick<
      Quest,
      "acceptedAt" | "completedAt" | "shelvedAt" | "heldAt" | "draftAt"
    >,
  ): QuestStatus {
    // Shelving is only reachable from "todo", so `shelvedAt` never
    // coexists with the other two. The precedence is defensive:
    // a real accept/complete always wins over a stale shelf.
    //
    // `heldAt` sits BELOW `completedAt` and ABOVE `acceptedAt`, and both
    // placements are decisions. Above `acceptedAt`, because a hold is
    // what the reader needs to see: the assignee is still recorded and
    // comes back untouched when the hold lifts, which is what makes
    // "on_hold" derivable at all. Below `completedAt`, because `holdQuest`
    // refuses a completed quest and `completeQuest` refuses a held one,
    // so the two cannot legitimately coexist — and if a row ever carries
    // both, the completion is the one that actually happened.
    //
    // `draftAt` sits BELOW `shelvedAt` and ABOVE nothing but `todo` (#E178):
    // a draft only ever replaces `todo`. A quest of a draft epic that is
    // shelved or held keeps `draftAt` underneath and reads `shelved` or
    // `on_hold`, which is what happened to it; unshelved or unheld, it reads
    // `draft` again with nothing to restore. Accept and hold refuse a quest
    // carrying it, so it never sits under `acceptedAt` legitimately, and if
    // it ever does, the accept is the one that happened.
    return quest.completedAt
      ? "completed"
      : quest.heldAt
        ? "on_hold"
        : quest.acceptedAt
          ? "in_progress"
          : quest.shelvedAt
            ? "shelved"
            : quest.draftAt
              ? "draft"
              : "todo";
  }

  mapQuestToResource(quest: Quest): QuestResource {
    const objectives = quest.objectives;

    const completedObjectives = objectives.filter((o) => o.completed).length;
    // Deliberately disjoint from `completed`: `completeQuest` refuses to
    // waive an objective that is already ticked, so no objective is ever
    // both, and a reader can trust `completed` to mean work that happened.
    const waivedObjectives = objectives.filter((o) => o.waivedReason).length;

    let totalTimeSpent = 0;
    for (const session of quest.timerSessions) {
      if (session.stoppedAt) {
        totalTimeSpent += Math.round(
          (new Date(session.stoppedAt).getTime() -
            new Date(session.startedAt).getTime()) /
            1000,
        );
      }
    }

    return {
      ...quest,
      objectives,
      metadata: {
        status: this.questStatus(quest),
        objectivesProgress: {
          completed: completedObjectives,
          waived: waivedObjectives,
          total: objectives.length,
        },
        totalTimeSpent,
      },
    };
  }
}
