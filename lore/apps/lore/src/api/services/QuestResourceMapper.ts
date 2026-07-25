import type { Quest } from "../entities/quests.ts";
import type { QuestResource } from "../schemas/questResourceSchema.ts";

/**
 * Maps a quest entity to a quest resource with computed metadata.
 */
export class QuestResourceMapper {
  mapQuestToResource(quest: Quest): QuestResource {
    // Synthesize objective IDs for legacy rows so clients always see one.
    // Backfill uses the current array position — deterministic for legacy
    // data (pre-dates ID writes), so consecutive reads return stable IDs.
    // The next write persists these IDs, after which the synthesis is a
    // no-op.
    const objectives = quest.objectives.map((obj, index) =>
      obj.id != null ? obj : { ...obj, id: index },
    );

    const completedObjectives = objectives.filter((o) => o.completed).length;

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
        // Shelving is only reachable from "new", so `shelvedAt` never
        // coexists with the other two. The precedence is defensive:
        // a real accept/complete always wins over a stale shelf.
        status: quest.completedAt
          ? "completed"
          : quest.acceptedAt
            ? "accepted"
            : quest.shelvedAt
              ? "shelved"
              : "new",
        objectivesProgress: {
          completed: completedObjectives,
          total: objectives.length,
        },
        totalTimeSpent,
      },
    };
  }
}
