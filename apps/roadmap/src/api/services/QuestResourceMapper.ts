import type { Quest } from "../entities/quests.ts";
import type { QuestResource } from "../schemas/questResourceSchema.ts";

/**
 * Maps a quest entity to a quest resource with computed metadata.
 */
export class QuestResourceMapper {
  mapQuestToResource(quest: Quest): QuestResource {
    const completedObjectives = quest.objectives.filter(
      (o) => o.completed,
    ).length;

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
      metadata: {
        status: quest.completedAt
          ? "completed"
          : quest.acceptedAt
            ? "accepted"
            : "new",
        objectivesProgress: {
          completed: completedObjectives,
          total: quest.objectives.length,
        },
        totalTimeSpent,
      },
    };
  }
}
