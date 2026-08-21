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
    quest: Pick<Quest, "acceptedAt" | "completedAt" | "shelvedAt">,
  ): QuestStatus {
    // Shelving is only reachable from "new", so `shelvedAt` never
    // coexists with the other two. The precedence is defensive:
    // a real accept/complete always wins over a stale shelf.
    return quest.completedAt
      ? "completed"
      : quest.acceptedAt
        ? "accepted"
        : quest.shelvedAt
          ? "shelved"
          : "new";
  }

  mapQuestToResource(quest: Quest): QuestResource {
    // Synthesize objective IDs for legacy rows so clients always see one.
    // Backfill uses the current array position — deterministic for legacy
    // data (pre-dates ID writes), so consecutive reads return stable IDs.
    // The next write persists these IDs, after which the synthesis is a
    // no-op.
    const objectives = quest.objectives.map((obj, index) =>
      obj.id != null ? { ...obj, id: obj.id } : { ...obj, id: index },
    );

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
