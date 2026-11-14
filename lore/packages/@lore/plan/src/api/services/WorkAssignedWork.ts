import { AssignedWorkRegistry } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { quests } from "../entities/quests.ts";

/**
 * Work's answer to "what has this viewer got open here": the quests they
 * accepted and have not completed, registered on core's
 * `AssignedWorkRegistry` (#E75, #Q2623).
 */
export class WorkAssignedWork {
  protected readonly registry = $inject(AssignedWorkRegistry);
  protected readonly quests = $repository(quests);

  constructor() {
    this.registry.register(async (projectId, userId) => {
      const mine = await this.quests.findMany({
        where: {
          projectId: { eq: projectId },
          completedAt: { isNull: true },
          acceptedBy: { eq: userId },
        },
        columns: ["id", "shortId", "title", "area", "priority"],
      });
      return mine.map((quest) => ({
        id: quest.id,
        shortId: quest.shortId,
        title: quest.title,
        area: quest.area,
        priority: quest.priority,
      }));
    });
  }
}
