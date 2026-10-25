import { ProjectDeletionService } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { quests } from "../entities/quests.ts";

/**
 * Work's step of a project deletion, registered on core's
 * `ProjectDeletionService` (#E75, #Q2623): the project's quests, deleted
 * explicitly rather than left to a database cascade.
 */
export class QuestProjectDeletion {
  protected readonly deletion = $inject(ProjectDeletionService);
  protected readonly quests = $repository(quests);

  constructor() {
    this.deletion.registerStep({
      order: 10,
      run: async (projectId) => {
        await this.quests.deleteMany({ projectId: { eq: projectId } });
      },
    });
  }
}
