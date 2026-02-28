import type { Task } from "../entities/tasks.ts";
import type { TaskResource } from "../schemas/taskResourceSchema.ts";

/**
 * Maps a task entity to a task resource with computed metadata.
 */
export class TaskResourceMapper {
  mapTaskToResource(task: Task): TaskResource {
    const completedObjectives = task.objectives.filter(
      (o) => o.completed,
    ).length;

    let totalTimeSpent = 0;
    for (const session of task.timerSessions) {
      if (session.stoppedAt) {
        totalTimeSpent += Math.round(
          (new Date(session.stoppedAt).getTime() -
            new Date(session.startedAt).getTime()) /
            1000,
        );
      }
    }

    return {
      ...task,
      metadata: {
        status: task.completedAt
          ? "completed"
          : task.acceptedAt
            ? "accepted"
            : "new",
        objectivesProgress: {
          completed: completedObjectives,
          total: task.objectives.length,
        },
        totalTimeSpent,
      },
    };
  }
}
